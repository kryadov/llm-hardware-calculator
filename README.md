# LLM Hardware Calculator

Work out what hardware you need to self-host Kimi, GLM, DeepSeek, Qwen or MiniMax — for a
given model, a given number of users, and a given latency target.

### ▶ **Live: https://kryadov.github.io/llm-hardware-calculator/**

No sign-up, no backend, no telemetry. The whole calculator runs in your browser.

---

## What it answers

**What should I buy?** Describe the job — model, workload profile, daily active users, SLA —
and get a ranked list of concrete deployments: how many accelerators, how many nodes, which
parallelism scheme, what interconnect they need, what it costs per million tokens, and the
`vllm serve` line to launch it.

**Will this fit on what I already have?** The *Verify* tab pins a specific accelerator and
GPU count and tells you whether it holds, how many concurrent sessions fit alongside the
weights, and what throughput to expect.

**Why can't I do it cheaper?** Every rejected configuration is reported with a machine-checked
reason and the size of the miss — "4× H100: 218 GiB short", "8× RTX 5090: 11 tok/s against a
25 tok/s SLA", "16× H100 across two nodes: tensor parallel over Ethernet". That list is half
the value of the tool.

## Coverage

**41 models**, each with hyperparameters read from the upstream `config.json`, not from memory:

| Family | Models |
|---|---|
| Kimi | K3, K2.5, K2.6, K2.7 Code, K2-Instruct, K2-Thinking |
| GLM | 5.2, 5.1, 4.7-Flash, 4.6, 4.5, 4.5-Air, 4-32B-0414, 4-9B-0414 |
| DeepSeek | V4-Pro, V4-Flash, V4-Flash-0731, V3.2-Exp, V3.1, V3-0324, R1, R1-Distill-Qwen-32B, R1-Distill-Llama-8B |
| Qwen | Qwen3.6-27B, Qwen3.6-35B-A3B, Qwen3.5-397B-A17B, Qwen3.5-122B-A10B, Qwen3-235B-A22B, Qwen3-Coder-480B-A35B, 32B, 30B-A3B, 14B, 8B, 4B |
| MiniMax | M3, M2.7, M2.5, M2.1, M2, M1-80k, Text-01 |

**25 accelerators** across five classes:

- **NVIDIA DC** — H100 SXM/PCIe, H200, B200, GB200, A100, L40S
- **AMD Instinct** — MI300X 192GB, MI325X 256GB, MI355X 288GB
- **Consumer** — RTX 5090, RTX PRO 6000 Blackwell 96GB, RTX 6000 Ada, RTX 4090, RTX 4070 Ti SUPER, RTX 4060 Ti, RTX 3090
- **Chinese** — Ascend 910B / 910C, Cambricon MLU590, Biren BR104, Moore Threads S5000, Hygon DCU Z100
- **CPU / unified memory** — Mac Studio M3 Ultra 512GB, EPYC Genoa + DDR5

## Method

Full derivation in [the design spec](docs/superpowers/specs/2026-08-04-llm-hardware-calculator-design.md).
The short version:

**Memory** is dominated by the KV cache, and the KV cache depends on the *attention type*,
not the parameter count:

```
GQA/MHA   bytes/tok = 2 × layers × kvHeads × headDim × kvBytes
MLA       bytes/tok = layers × (kvLoraRank + qkRopeDim) × kvBytes    ← no ×2, one latent
Hybrid    bytes/tok = fullAttnLayers × (GQA formula) + linear state
```

DeepSeek and Kimi use MLA, which is why a 671B model serves long contexts on hardware a
GQA model of the same depth could not. Two corrections that catch people out are modelled
explicitly: the cache is **replicated** when `TP > kvHeads`, and the MLA latent is not
sharded across tensor-parallel ranks at all.

For MoE models, memory holds **all** parameters while compute touches only the **active**
ones — 1T vs 32B for Kimi K2, 671B vs 37B for DeepSeek V3. That 20-30× gap is the reason
these models are hostable.

**Throughput** splits by phase. Decode is memory-bandwidth bound, prefill is compute bound,
and they are combined through utilization rather than by guessing how a scheduler
interleaves them:

```
prefillLoad = RPS × promptTok × (1 − prefixCacheHit) / prefillCapacity
decodeLoad  = RPS × outputTok / decodeCapacity
replicas    = ceil((prefillLoad + decodeLoad) / 0.8)
```

A configuration passes only if it clears per-user tokens/sec, TTFT, **and** total
utilization. Misses within 20% stay in the results carrying a warning; larger misses are
rejected — the tolerance exists because the model's own accuracy is ±25%, and hiding a
config that missed by 10% would be false precision.

**Cost** reports two token prices, because one of them misleads on its own:

- **$/1M output tokens** — the headline figure, and the one comparable to published API
  price lists, which bill prompt and output separately.
- **$/1M tokens (blended)** — prompt and output together. On a prompt-heavy profile like a
  coding agent (12k prompt against 800 output) this runs ~15× lower and must not be read
  as an API-equivalent price.

Both are measured at saturation along the workload's own prefill/decode mix.

**Every throughput-derived number is shown as a ±25% band**, never a point value.

## Data provenance

- **Models** — every entry carries a `sourceUrl` pointing at the exact `config.json` it was
  read from and a `verifiedAt` date. Layer counts, KV heads, MLA ranks and MoE expert counts
  come from upstream, not from recollection.
- **Accelerators** — memory, bandwidth and peak FLOPS from vendor datasheets. Chinese parts
  and CPU/Apple entries carry a `note` saying the figures are vendor-claimed and not
  independently verified.
- **Efficiency coefficients** — MFU and MBU are data, not constants buried in code, and are
  stated per hardware family with a note. Chinese accelerators carry lower coefficients
  (MBU 0.45, MFU 0.22 against 0.70/0.45 for Hopper/Blackwell). That reflects kernel maturity;
  a calculator that ignored it would systematically flatter the cheaper option.
- **Prices** — isolated in `src/data/pricing.json` with a single `pricesAsOf` date, shown in
  the footer. They are the first thing to go stale; the calculator still ranks by GPU count
  with pricing switched off.

## Development

```bash
npm ci
npm run dev        # local dev server
npm test           # unit + reality-check suite
npm run typecheck
npm run build
```

The calculation core in `src/core/` is pure TypeScript with no runtime dependencies and no
React import — a lint test enforces that. It is covered by unit tests for the formulas plus
a reality-check suite that guards against order-of-magnitude errors against known
deployments.

Deployment to GitHub Pages runs from `.github/workflows/deploy.yml` on every push to `main`;
red tests block the deploy.

## Disclaimer

This is an **analytical estimate, accurate to roughly ±25-30%**. It is not a substitute for
load-testing your own workload on your own hardware. Real throughput depends on your
framework version, kernel maturity, batch composition, request-length distribution and
scheduler tuning — none of which a closed-form model can capture.

Prices are as of the date shown in the footer and go stale quickly. Verify with your vendor
before committing budget.

## License

MIT
