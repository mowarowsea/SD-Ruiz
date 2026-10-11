# Guidance (Ruiz): CFG を良くする誘導を Forge Neo に足す拡張 (Neo には入っていないため)。
#
# PAG (Perturbed-Attention Guidance, arXiv:2403.17377)
#   UNet の middle ブロックの self-attention を「何も見ない」(恒等) にした、わざと構造の崩れた予測を作り、
#   そこから離れる向きに押す。構図・形が締まり、崩れた手足が減りやすい。1 ステップに UNet を 1 回多く回すので約 1.5 倍遅い
# APG (Adaptive Projected Guidance, arXiv:2410.02416)
#   CFG の押す向き (cond - uncond) を、cond に平行な成分 (色・明るさを焼く) と直交する成分に分け、平行な成分を弱める。
#   CFG を上げても焼けにくくなるので、CFG を上げてプロンプトに強く従わせられる。計算は増えない
#
# API (alwayson_scripts):
#   "Guidance (Ruiz)": [enable, pag_scale, apg_enabled, apg_eta, apg_norm_threshold, apg_momentum]
#   pag_scale: 0 で PAG なし。3 前後
#   apg_eta: 平行成分を残す割合 (0 で捨てる)。apg_norm_threshold: 押す強さの上限 (0 で上限なし)。apg_momentum: 前のステップの向きを混ぜる (負で振動を抑える)

import gradio as gr
import torch

from backend.sampling.sampling_function import calc_cond_uncond_batch
from modules import scripts
from modules.ui_components import InputAccordion


def perturbed_attention(q, k, v, extra_options, mask=None):
    # softmax(QK^T) を単位行列にしたのと同じ: 各トークンが自分の value だけを見る
    return v


def with_attn1_replace(model_options: dict, patch, block: tuple) -> dict:
    to = dict(model_options.get("transformer_options", {}))
    replace = dict(to.get("patches_replace", {}))
    attn1 = dict(replace.get("attn1", {}))
    attn1[block] = patch
    replace["attn1"] = attn1
    to["patches_replace"] = replace
    out = dict(model_options)
    out["transformer_options"] = to
    return out


def patch_pag(unet, scale: float):
    def post_cfg(args):
        denoised = args["denoised"]
        if scale <= 0:
            return denoised
        model_options = with_attn1_replace(args["model_options"], perturbed_attention, ("middle", 0))
        pag, _ = calc_cond_uncond_batch(args["model"], args["cond"], None, args["input"], args["sigma"], model_options)
        return denoised + (args["cond_denoised"] - pag) * scale

    unet.append_model_option("sampler_post_cfg_function", post_cfg)
    return unet


def patch_apg(unet, eta: float, norm_threshold: float, momentum: float):
    state = {"avg": None, "last_sigma": None}
    dims = [-1, -2, -3]

    def cfg(args):
        x = args["input"]
        cond, uncond = args["cond_denoised"], args["uncond_denoised"]
        scale = args["cond_scale"]
        sigma = float(args["sigma"].flatten()[0])
        # 新しいサンプリング (Hires fix の 2 回目なども) の始まりで、移動平均を捨てる
        if state["last_sigma"] is None or sigma > state["last_sigma"]:
            state["avg"] = None
        state["last_sigma"] = sigma

        guidance = cond - uncond
        if momentum != 0:
            if state["avg"] is None or state["avg"].shape != guidance.shape:
                state["avg"] = guidance
            else:
                state["avg"] = momentum * state["avg"] + guidance
            guidance = state["avg"]
        if norm_threshold > 0:
            norm = guidance.norm(p=2, dim=dims, keepdim=True)
            guidance = guidance * torch.clamp(norm_threshold / (norm + 1e-8), max=1.0)

        g = guidance.double()
        unit = torch.nn.functional.normalize(cond.double(), dim=dims)
        parallel = (g * unit).sum(dim=dims, keepdim=True) * unit
        orthogonal = g - parallel
        modified = (orthogonal + eta * parallel).to(guidance.dtype)
        # Forge の sampler_cfg_function は「x - 結果の denoised」を返す決まり
        return x - (cond + (scale - 1) * modified)

    unet.set_model_sampler_cfg_function(cfg)
    return unet


class RuizGuidance(scripts.Script):
    sorting_priority = 2028

    def title(self):
        return "Guidance (Ruiz)"

    def show(self, is_img2img):
        return scripts.AlwaysVisible

    def ui(self, *args, **kwargs):
        with InputAccordion(False, label=self.title()) as enable:
            pag_scale = gr.Slider(0.0, 10.0, value=3.0, step=0.1, label="PAG Scale (0 = off)")
            apg = gr.Checkbox(False, label="APG")
            with gr.Row():
                eta = gr.Slider(0.0, 1.0, value=0.0, step=0.05, label="APG eta")
                norm = gr.Slider(0.0, 50.0, value=15.0, step=0.5, label="APG Norm Threshold")
                mom = gr.Slider(-1.0, 1.0, value=-0.5, step=0.05, label="APG Momentum")
        return [enable, pag_scale, apg, eta, norm, mom]

    def process_before_every_sampling(self, p, enable, pag_scale, apg, eta, norm, mom, *args, **kwargs):
        if not enable or (float(pag_scale) <= 0 and not apg):
            return
        unet = p.sd_model.forge_objects.unet.clone()
        if float(pag_scale) > 0:
            unet = patch_pag(unet, float(pag_scale))
            p.extra_generation_params["pag_scale"] = float(pag_scale)
        if apg:
            unet = patch_apg(unet, float(eta), float(norm), float(mom))
            p.extra_generation_params["apg"] = f"eta {float(eta)} / norm {float(norm)} / momentum {float(mom)}"
        p.sd_model.forge_objects.unet = unet
