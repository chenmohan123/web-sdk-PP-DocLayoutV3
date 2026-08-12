from __future__ import annotations

import torch


class PPDocLayoutExportWrapper(torch.nn.Module):
    output_names = ("logits", "pred_boxes", "order_logits", "out_masks")

    def __init__(self, model: torch.nn.Module) -> None:
        super().__init__()
        self.model = model

    def forward(self, pixel_values: torch.Tensor) -> tuple[torch.Tensor, ...]:
        output = self.model(pixel_values=pixel_values)
        return tuple(getattr(output, name) for name in self.output_names)

