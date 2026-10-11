# Spectrum (Ruiz): Forge Neo 内蔵の sd_forge_spectrum を直したもの。
# 元: https://github.com/ruwwww/comfyui-spectrum-sdxl
#
# 内蔵版は UNet の呼び出し 1 回を 1 ステップと数え、cond と uncond の出力を同じ予測器に入れている。
# Forge は VRAM の空きしだいで cond と uncond を 1 回にまとめたり 2 回に分けたりするので、
#   - 分けると 1 ステップが 2 つに数えられ、cond と uncond が混ざった予測になる
#   - まとめた回 (バッチ 2) の予測を分けた回 (バッチ 1) に返して落ちる ("doesn't match the broadcast shape")
# ここでは timestep が変わったときだけステップを進め、予測器を cond / uncond ごとに分ける。
# Guidance (Ruiz) の PAG の追加の計算 (transformer_options の ruiz_perturbed) は素通しする。
# まとめて計算されている間の動きは内蔵版と同じ。
#
# API (alwayson_scripts) の引数は内蔵版と同じ:
#   "Spectrum (Ruiz)": [enable, w, m, lam, window_size, flex_window, warmup_steps, stop_caching_step]

import math

import gradio as gr
import torch

from modules import scripts, shared
from modules.ui_components import InputAccordion


class FastChebyshevForecaster:
    def __init__(self, m: int, lam: float, steps: int):
        self.M = m
        self.K = max(m + 2, 8)
        self.lam = lam
        self.H_buf = []
        self.T_buf = []
        self.time_buf = []
        self.shape = None
        self.dtype = None
        self.t_max = float(steps)

    def _taus(self, t: float) -> float:
        return (t / self.t_max) * 2.0 - 1.0

    def _build_design(self, taus: torch.Tensor) -> torch.Tensor:
        taus = taus.reshape(-1, 1)
        T = [torch.ones((taus.shape[0], 1), device=taus.device, dtype=torch.float32)]
        if self.M > 0:
            T.append(taus)
            for _ in range(2, self.M + 1):
                T.append(2 * taus * T[-1] - T[-2])
        return torch.cat(T[: self.M + 1], dim=1)

    def update(self, cnt: int, h: torch.Tensor):
        if self.shape and h.shape != self.shape:
            self.H_buf.clear()
            self.T_buf.clear()
            self.time_buf.clear()

        self.shape = h.shape
        self.dtype = h.dtype

        self.H_buf.append(h.reshape(-1))
        self.T_buf.append(self._taus(cnt))
        self.time_buf.append(cnt)
        if len(self.H_buf) > self.K:
            self.H_buf.pop(0)
            self.T_buf.pop(0)
            self.time_buf.pop(0)

    def predict(self, cnt: int, w: float) -> torch.Tensor:
        device = self.H_buf[-1].device

        H = torch.stack(self.H_buf, dim=0).to(torch.float32)
        T = torch.tensor(self.T_buf, dtype=torch.float32, device=device)

        X = self._build_design(T)
        lamI = self.lam * torch.eye(self.M + 1, device=device)
        XtX = X.T @ X + lamI

        try:
            L = torch.linalg.cholesky(XtX)
        except RuntimeError:
            jitter = 1e-5 * XtX.diag().mean()
            L = torch.linalg.cholesky(XtX + jitter * torch.eye(self.M + 1, device=device))

        coef = torch.cholesky_solve(X.T @ H, L)
        pred_cheb = (self._build_design(torch.tensor([self._taus(cnt)], device=device)) @ coef).squeeze(0)

        if len(self.H_buf) >= 2:
            h_i = self.H_buf[-1].to(torch.float32)
            h_im1 = self.H_buf[-2].to(torch.float32)
            dt_last = self.time_buf[-1] - self.time_buf[-2]
            k = (cnt - self.time_buf[-1]) / dt_last if dt_last > 1e-8 else 1.0
            h_taylor = h_i + k * (h_i - h_im1)
        else:
            h_taylor = self.H_buf[-1].to(torch.float32)

        res = (1 - w) * h_taylor + w * pred_cheb
        return res.to(self.dtype).view(self.shape)


def patch(model, steps: int, w: float, m: int, lam: float, window_size: int, flex_window: float, warmup_steps: int, stop_caching_step: float):
    state = {"last_t": None, "cnt": 0, "num_cached": 0, "curr_ws": float(window_size), "actual": True, "forecasters": {}}
    auto_stop = int(steps * stop_caching_step)

    def begin_step():
        cnt = state["cnt"]
        if cnt < warmup_steps or cnt >= auto_stop:
            actual = True
        else:
            actual = (state["num_cached"] + 1) % max(1, math.floor(state["curr_ws"])) == 0
        if actual:
            if cnt >= warmup_steps:
                state["curr_ws"] += flex_window
            state["num_cached"] = 0
        else:
            state["num_cached"] += 1
        state["actual"] = actual

    def wrapper(model_function, kwargs):
        x, timestep, c = kwargs["input"], kwargs["timestep"], kwargs["c"]
        # Guidance (Ruiz) の PAG が同じステップでもう 1 回回す、わざと崩した計算。数えず、予測にも混ぜない
        if c.get("transformer_options", {}).get("ruiz_perturbed"):
            return model_function(x, timestep, **c)
        t = timestep[0].item() if isinstance(timestep, torch.Tensor) else float(timestep)

        if state["last_t"] is None or t > state["last_t"]:
            # 新しいサンプリング (Hires fix の 2 回目なども) の始まり
            state.update(cnt=0, num_cached=0, curr_ws=float(window_size), forecasters={})
            begin_step()
        elif t < state["last_t"]:
            state["cnt"] += 1
            begin_step()
        state["last_t"] = t

        # 同じ種類が複数あるとき (エリア指定の cond など) も区別できるよう、出現順も鍵に入れる
        keys = []
        seen = {}
        for kind in kwargs["cond_or_uncond"]:
            seen[kind] = seen.get(kind, -1) + 1
            keys.append((kind, seen[kind]))

        forecasters = state["forecasters"]
        if not state["actual"] and all(k in forecasters for k in keys):
            return torch.cat([forecasters[k].predict(state["cnt"], w=w) for k in keys], dim=0).to(x.dtype)

        out = model_function(x, timestep, **c)
        for k, h in zip(keys, out.chunk(len(keys))):
            if k not in forecasters:
                forecasters[k] = FastChebyshevForecaster(m=m, lam=lam, steps=steps)
            forecasters[k].update(state["cnt"], h)
        return out

    new_model = model.clone()
    new_model.set_model_unet_function_wrapper(wrapper)
    return new_model


class RuizSpectrum(scripts.Script):
    sorting_priority = 2027

    def title(self):
        return "Spectrum (Ruiz)"

    def show(self, is_img2img):
        return scripts.AlwaysVisible

    def ui(self, *args, **kwargs):
        with InputAccordion(False, label=self.title()) as enable:
            with gr.Row():
                w = gr.Slider(0.0, 1.0, value=0.25, step=0.05, label="Prediction Weighting")
                m = gr.Slider(1, 8, value=6, step=1, label="Polynomial Degree")
            with gr.Row():
                lam = gr.Slider(0.0, 2.0, value=0.5, step=0.05, label="Regularization")
                window_size = gr.Slider(1, 10, value=2, step=1, label="Cache Window")
            flex_window = gr.Slider(0.0, 2.0, value=0.0, step=0.05, label="Window Growth")
            with gr.Row():
                warmup_steps = gr.Slider(0, 20, value=6, step=1, label="Warmup Steps")
                stop_caching_step = gr.Slider(0.0, 1.0, value=0.9, step=0.05, label="Stop Caching Step")
        return [enable, w, m, lam, window_size, flex_window, warmup_steps, stop_caching_step]

    def process_before_every_sampling(self, p, enable: bool, *args, **kwargs):
        if not enable:
            return

        if shared.opts.skip_early_cond > 0.0 or shared.opts.s_min_uncond > 0.0:
            print('Spectrum (Ruiz) does not support "Ignore/Skip Negative Prompt" optimizations...')
            return

        w, m, lam, window_size, flex_window, warmup_steps, stop_caching_step = args
        unet = p.sd_model.forge_objects.unet
        p.sd_model.forge_objects.unet = patch(unet, p.steps, float(w), int(m), float(lam), int(window_size), float(flex_window), int(warmup_steps), float(stop_caching_step))

        for k, v in zip(["spec_w", "spec_m", "spec_lam", "spec_window_size", "spec_flex_window", "spec_warmup_steps", "spec_stop_caching_step"], args):
            p.extra_generation_params[k] = v
