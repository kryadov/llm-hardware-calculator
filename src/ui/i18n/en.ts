/**
 * English dictionary — the source of truth for every user-facing string.
 *
 * `ru.ts` is typed against `typeof en`, so adding a key here without translating
 * it is a compile error, not a silently English label in the Russian UI.
 *
 * Conventions:
 * - Leaves are strings only. Placeholders are `{name}` and are substituted with
 *   `fill()` from `./index`; the same placeholders must appear in every language.
 * - Nothing here formats numbers. Units live under `units` and are appended by
 *   the formatting helpers in `ui/results/format.ts`.
 *
 * Implements the plan's Task 12 and the spec's §4 (interface), §7 (error
 * handling) and §3.5 (the two price metrics).
 */
const en = {
  header: {
    title: 'LLM Hardware Calculator',
    tagline: 'Size the servers for self-hosted inference of open-weights models. Data as of 2026-08-06.',
    tabs: {
      explore: 'Explore',
      verify: 'Verify',
      deploy: 'Deploy',
    },
    tabHint: {
      explore: 'What should I buy for this load?',
      verify: 'I already have this hardware — will it hold?',
      deploy: 'What does this configuration cost to actually run, turnkey?',
    },
    lang: {
      label: 'Language',
      en: 'EN',
      ru: 'RU',
      switchToEn: 'Switch to English',
      switchToRu: 'Switch to Russian',
    },
    theme: {
      label: 'Theme',
      toDark: 'Switch to dark theme',
      toLight: 'Switch to light theme',
    },
    github: {
      label: 'GitHub',
      title: 'Source code on GitHub',
    },
  },

  input: {
    model: {
      section: 'Model',
      label: 'Model',
      hint: 'Hyperparameters come from the upstream config.json; the link on the card points at it.',
      custom: 'Custom model',
      customHint: 'Enter the hyperparameters by hand when the catalog does not have your model yet.',
      totalParams: 'Total parameters',
      activeParams: 'Active parameters',
      activeParamsHint:
        'MoE keeps every parameter in memory but only routes through the active ones, which is why such models are hostable at all.',
      layers: 'Layers',
      hiddenSize: 'Hidden size',
      vocabSize: 'Vocabulary',
      attention: 'Attention',
      maxContextNative: 'Native context',
      nativeDtype: 'Checkpoint dtype',
      source: 'config.json',
      sourceTitle: 'Open the upstream config.json',
      verifiedAt: 'Verified {date}',
      badgeMoe: 'MoE',
      badgeDense: 'dense',
    },
    quant: {
      section: 'Quantization',
      label: 'Weight quantization',
      hint: 'Lower precision shrinks weights — and memory — at a small accuracy cost. BF16: safest, 2× larger. FP8: half the size, needs Hopper/Blackwell/MI300. INT8/INT4: smallest, runs anywhere, but below INT8 quality drops noticeably on reasoning and code. Start with Any and let the solver rank; pin a quant only if you have a specific checkpoint.',
      auto: 'Any',
      autoHint: 'Let the solver try every quantization and rank the results.',
    },
    profile: {
      section: 'Load',
      label: 'Load profile',
      hint: 'A profile presets request rate, prompt and output lengths, peak factor and SLA. Editing any of them switches the profile to Custom.',
      custom: 'Custom',
      customBadge: 'edited',
      derived:
        '{requests} requests/day × {prompt} prompt × {output} output, peak ×{peak}',
    },
    dau: {
      label: 'Daily active users',
      short: 'DAU',
      hint: 'Distinct users per day. Peak concurrency is derived from this, the request rate and the peak factor.',
    },
    vendors: {
      section: 'Hardware',
      label: 'Vendors',
      hint: 'Narrow the search. Unchecking every vendor leaves nothing to rank.',
      cpuAppleHint: 'CPU / Apple silicon is viable for batch workloads. For chat, TTFT will likely exceed the SLA — relax it in Advanced → SLA TTFT (seconds), or switch the load profile to Batch.',
    },
    costMode: {
      section: 'Cost',
      label: 'Cost mode',
      hint: 'Buy ranks by 3-year TCO, Rent by $ per 1M output tokens, Off ranks by GPU count and ignores prices entirely.',
    },
    verify: {
      section: 'Your hardware',
      hint: 'Pin what you own. The same solver runs, but instead of enumerating hardware it evaluates the ways this fleet can be split.',
      accelerator: 'Accelerator',
      acceleratorHint: 'The accelerator you already have or are about to buy.',
      totalGpus: 'How many',
      totalGpusHint: 'Total accelerators in the fleet, across all nodes.',
      quant: 'Quantization',
      quantHint: 'The checkpoint you intend to serve.',
      verdictPass: 'This fleet holds the load.',
      verdictWarn: 'It holds, but misses part of the SLA — see the warnings.',
      verdictFail: 'This fleet does not hold the load.',
    },
    reset: 'Reset to defaults',
    share: 'Copy link to this calculation',
  },

  advanced: {
    section: 'Advanced',
    hint: 'Override anything the profile presets. Edited fields switch the profile label to Custom instead of being silently overwritten.',
    promptTokens: {
      label: 'Prompt tokens',
      hint: 'Average prompt length. Drives prefill cost, KV cache footprint and therefore how many sessions fit next to the weights.',
    },
    outputTokens: {
      label: 'Output tokens',
      hint: 'Average answer length. Drives decode demand and how long a request holds a decoding slot.',
    },
    peakFactor: {
      label: 'Peak factor',
      hint: 'Peak traffic over the daily average. Sizing on the daily mean under-provisions every real deployment.',
    },
    prefixCacheHitRate: {
      label: 'Prefix cache hit rate',
      hint: 'Fraction of prompt tokens already cached. A coding agent repeats its system prompt and files, and 0.7 cuts prefill work threefold.',
    },
    slaTokensPerSec: {
      label: 'SLA: tokens/s per user',
      hint: 'The decoding speed one user must see. Below roughly 20 tok/s reading feels slower than generation.',
    },
    slaTtftSeconds: {
      label: 'SLA: TTFT, p95',
      hint: 'Time to first token at p95, including queueing. Missing it by up to 20% leaves a warning; more than that rejects the candidate.',
    },
    maxContext: {
      label: 'Max context',
      hint: 'The context window you will actually serve. It caps KV cache per sequence and cannot exceed what the model supports.',
    },
    speculative: {
      label: 'Speculative decoding / MTP',
      hint: 'Applies a 1.5–1.8× decode multiplier. The real gain depends on the acceptance rate on your traffic, so it is off by default.',
      on: 'On',
      off: 'Off',
    },
    gpuMemUtil: {
      label: 'gpu-memory-utilization',
      hint: 'Fraction of HBM the framework is allowed to claim. Everything left over after weights and overhead becomes KV cache.',
    },
    kvQuant: {
      label: 'KV cache quantization',
      hint: 'Set independently of weight quantization. FP8 halves the cache against FP16 and buys concurrency at a small accuracy cost.',
    },
  },

  load: {
    title: 'Peak load',
    peakRps: 'req/s',
    concurrentSeqs: 'concurrent sessions',
    decodeNeeded: 'decode',
    prefillNeeded: 'prefill',
    avgSeqLen: 'avg sequence',
    needed: 'Needed',
    summary:
      'Peak load: {rps} req/s · {seqs} sessions · needs {decode} decode and {prefill} prefill',
    concurrencyNote:
      'Concurrency follows Little’s law: arrival rate × how long one answer holds a decoding slot.',
  },

  card: {
    title: '{gpus}× {accelerator}',
    subtitle: '{nodes} · {parallelism}',
    best: 'Best match',
    quant: 'Quantization',
    framework: 'Framework',
    totalGpus: 'Accelerators',
    totalNodes: 'Nodes',
    replicas: 'Replicas',
    gpusPerReplica: 'GPUs per replica',
    parallelism: 'Parallelism',
    tp: 'Tensor parallel',
    pp: 'Pipeline parallel',
    ep: 'Expert parallel',
    bubblePenalty: 'Pipeline bubble',
    interconnect: 'Interconnect required',
    interconnectNone: 'Single GPU — no interconnect required',
    interconnectIntraNode: '{fabric}, within one node — no network fabric needed',

    perUserTps: 'Per user',
    ttft: 'TTFT',
    stepTime: 'Decode step',
    batch: 'Batch',
    decodeCapacity: 'Decode capacity per replica',
    prefillCapacity: 'Prefill capacity per replica',
    commFraction: 'Communication share of a step',
    prefillLoad: 'Prefill utilization',
    decodeLoad: 'Decode utilization',
    utilization: 'Utilization',
    utilizationHint:
      'Prefill and decode share the same accelerators; the sum is the fraction of the fleet the load actually consumes.',

    memoryTitle: 'Memory per GPU',
    weightsPerGpu: 'Weights',
    kvPerGpu: 'KV cache',
    overheadPerGpu: 'Overhead',
    availablePerGpu: 'Available',
    freePerGpu: 'Free',
    kvBytesPerToken: 'KV per token',
    kvReplication: 'KV replication',
    kvReplicationHint:
      'With TP above the KV head count the cache is replicated across ranks, so it costs more than the plain formula suggests.',
    maxConcurrentSeqs: 'Sessions that fit',

    hostTitle: 'Node around the accelerators',
    hostRam: 'Host RAM',
    hostRamHint: 'Rule of thumb: about twice the aggregate HBM of a node.',
    disk: 'Disk for weights',
    diskHint: 'NVMe, weights plus tokenizer, index and safetensors padding.',

    costTitle: 'Cards, chassis & electricity',
    costTitleHint:
      'Hardware and power only. Racks, networking, redundancy, staffing and software are not in this number — see the turnkey estimate.',
    capex: 'CAPEX',
    capexHint: 'Accelerators, chassis and InfiniBand switches for multi-node.',
    hourlyRent: 'Cloud, per hour',
    powerWatts: 'Power draw',
    powerHint: 'TDP across the fleet with PUE 1.3.',
    hourlyPower: 'Electricity, per hour',
    tco3y: 'TCO, 3 years',
    pricePerMOutput: 'Per 1M output tokens',
    pricePerMOutputNote:
      'Comparable to API pricing: the whole cost of serving the load divided by output tokens alone.',
    pricePerMBlended: 'Per 1M tokens, prompt + output blended',
    pricePerMBlendedNote:
      'Not an API-comparable figure. On prompt-heavy profiles it lands far below the per-output-token price and flatters the configuration.',
    saturatedTokensPerSec: 'Tokens/s at saturation',
    saturatedHint:
      'What the fleet sustains at 100% utilization along this workload’s own prefill/decode mix — the denominator of both price figures.',
    costUnavailable: 'No price on file for this accelerator',

    launchTitle: 'Launch command',
    launchHint: 'Sized for this configuration. Check the model path against your local checkout.',

    expand: 'Configuration, cost and launch command',
    collapse: 'Collapse',
    modelSource: 'Model config.json',
    acceleratorNote: 'Datasheet caveat',

    turnkeyNote:
      'Not reserved for redundancy — losing one replica can take the whole service down.',
    turnkeyButton: 'Compute full turnkey cost →',
    verifyButton: 'Open in Verify →',
  },

  memoryBar: {
    title: 'Memory per GPU',
    segment: {
      weights: 'Weights',
      kv: 'KV cache',
      overhead: 'Overhead',
      free: 'Free',
    },
    legend: '{weights} weights · {kv} KV · {overhead} overhead · {free} free',
    outOf: 'of {total} usable',
  },

  rejection: {
    title: 'Rejected',
    titleCount: 'Rejected ({count})',
    hint: 'Why nothing cheaper works. Each row carries the machine-readable reason the solver produced.',
    colConfig: 'Configuration',
    colReason: 'Reason',
    colDetail: 'Detail',
    deficit: 'short by {gib}',
    actualVsRequired: '{actual} against {required} required',
    truncated: 'Showing the first {count} rejections.',
    reason: {
      oom: 'Does not fit in memory',
      slaTps: 'Too slow per user',
      slaTtft: 'TTFT above the SLA',
      interconnect: 'Interconnect too weak',
      tpNotDivisible: 'Tensor parallel does not divide',
      nodeLimit: 'Too many accelerators per node',
      unsupportedQuant: 'Quantization not supported',
      contextTooLong: 'Context longer than the model supports',
      internal: 'Degenerate configuration',
    },
    reasonHelp: {
      oom: 'Weights plus overhead plus a single sequence of KV cache exceed the usable HBM of the fleet.',
      slaTps: 'Decoding is memory-bound; at this batch size one user would not see the requested tokens/s.',
      slaTtft: 'Prefill on this hardware takes longer than the allowed time to first token.',
      interconnect:
        'Tensor parallel needs NVLink, xGMI or HCCS inside a node; across nodes it needs InfiniBand at 400 Gb/s or better.',
      tpNotDivisible:
        'Tensor parallel size must divide the attention heads, the KV heads and the accelerators available in a node.',
      nodeLimit: 'The replica needs more accelerators in one node than the platform allows.',
      unsupportedQuant: 'This accelerator has no hardware path for that data type in the supported frameworks.',
      contextTooLong: 'The requested context exceeds what the checkpoint was trained and released for.',
      internal:
        'The numbers came out non-finite — a degenerate combination. The candidate is dropped and the rest of the results stand.',
    },
  },

  warning: {
    slaTps:
      'Per-user speed is under the SLA by {miss} — within the ±25% accuracy of this model, so treat it as borderline rather than proven.',
    slaTtft:
      'TTFT is over the SLA by {miss}. Shorter prompts or a higher prefix cache hit rate are the cheapest fixes.',
    degradedInterconnect:
      'Tensor parallel runs across nodes here. It works over InfiniBand at 400 Gb/s, but expect the communication share of a decode step to grow.',
    immatureStack:
      'The software stack for this accelerator is less mature: efficiency coefficients are conservative and kernel coverage varies by model.',
  },

  howComputed: {
    title: 'How this was computed',
    hint: 'Your own numbers substituted into the formulas. No hidden constants.',
    accuracy:
      'The analytical model is accurate to about ±25%, so every result is a band rather than a point.',
    weights: {
      title: 'Weights',
      body: 'Effective bit width counts the scale and zero-point of the quantization group, otherwise quantized checkpoints come out too cheap. For MoE, memory holds every parameter while compute only touches the active ones.',
      formula: 'effBits = baseBits + (scaleBits + zeroBits) / groupSize\nweightBytes = totalParams × effBits / 8',
    },
    kvCache: {
      title: 'KV cache',
      body: 'The per-token cost depends on the attention type, not on how big the model is. MLA stores one latent per layer, so it drops the factor of two that GQA pays for keys and values.',
      formula:
        'GQA/MHA: bytes/tok = 2 × layers × kvHeads × headDim × kvBytes\nMLA:     bytes/tok = layers × (kvLoraRank + qkRopeDim) × kvBytes\nHybrid:  bytes/tok = fullAttnLayers × GQA + linearLayers × constState',
    },
    fit: {
      title: 'What fits',
      body: 'The real question is not whether the model fits but how many sessions fit next to it. Whatever HBM the weights and overhead leave becomes the KV budget, and that budget divided by one sequence gives the concurrency ceiling.',
      formula:
        'perGpu    = weights/N + kvPerGpu + overhead\navailable = hbmPerGpu × gpuMemUtil\nkvBudget  = (available − weights/N − overhead) × N\nmaxConcurrentSeqs = kvBudget / (kvBytesPerTok × avgSeqLen)',
    },
    decode: {
      title: 'Decode',
      body: 'Decoding is memory-bound: every step streams the active weights and the whole cache through HBM. Add the all-reduce, which is negligible over NVLink and eats more than half the step over PCIe at TP=8.',
      formula:
        'stepBytes      = activeParamBytes/N + batch × kvBytesPerTok × avgSeqLen / N\nstepTime       = stepBytes / (hbmBw × MBU) + commTime(TP, interconnect)\nperUserTps     = 1 / stepTime\ndecodeCapacity = batch / stepTime',
    },
    prefill: {
      title: 'Prefill',
      body: 'Prefill is compute-bound, and attention adds a term quadratic in prompt length — which is why long-context profiles are dominated by prefill rather than by generation.',
      formula:
        'flops           = 2 × activeParams × promptTok + 2 × layers × heads × headDim × promptTok²\nprefillTime     = flops / (peakFlops(dtype) × MFU × N)\nprefillCapacity = promptTok / prefillTime\nTTFT            = prefillTime + queueing',
    },
    utilization: {
      title: 'Utilization and fleet size',
      body: 'Rather than imitating the scheduler, both phases are converted to a fraction of the fleet they consume and added. The 0.8 divisor leaves headroom for traffic tails.',
      formula:
        'prefillLoad = RPS × promptTok × (1 − prefixHitRate) / prefillCapacity\ndecodeLoad  = RPS × outputTok / decodeCapacity\nreplicas    = ceil((prefillLoad + decodeLoad) / 0.8)\ntotalGpus   = N × replicas',
    },
    cost: {
      title: 'Cost per token',
      body: 'The denominator is not prefillCapacity + decodeCapacity: each of those assumes the accelerator is entirely busy with its own phase. Instead the fleet is scaled to saturation along this workload’s own mix, so at utilization u one replica saturates at demand / u.',
      formula:
        'saturatedTokensPerSec = (prefillNeeded + decodeNeeded) × replicas / utilization\n$/1M tokens           = hourlyCost / (saturatedTokensPerSec × 3600) × 1e6',
    },
    coefficients: {
      title: 'Efficiency coefficients',
      body: 'MBU for decode and MFU for prefill live in a data file per hardware family and framework, not as constants in the code. Lower numbers on Chinese accelerators reflect the state of the kernels; hiding that would tilt the answer toward the cheap option.',
      formula: 'MBU {mbu} · MFU {mfu} · family {family} · framework {framework}',
    },
    sources: {
      title: 'Sources',
      body: 'Model hyperparameters cite the upstream config.json with the date they were checked. Prices sit in their own file with a single as-of date.',
      formula: 'models.json → sourceUrl · pricing.json → pricesAsOf',
    },
  },

  empty: {
    title: 'Nothing holds this load',
    body: 'No configuration in the selected vendors satisfies the memory, SLA and interconnect constraints at once. Here is the boundary of what is possible.',
    nearestMiss: 'Closest attempt: {config}',
    nearestMissReason: 'Blocked by: {reason}',
    relaxTitle: 'Which knob to relax',
    relax: {
      context: 'Lower the max context — KV cache scales linearly with it and usually decides whether anything fits.',
      sla: 'Loosen the SLA on tokens/s or TTFT — a 20% relaxation often turns rejection into a warning.',
      quant: 'Quantize harder — FP8 weights halve the footprint against BF16, and FP8 KV cache halves the cache.',
      vendors: 'Widen the vendor filter — the constraint may simply be that everything capable was filtered out.',
      dau: 'Lower DAU or the peak factor — concurrency, not model size, is what most deployments actually run out of.',
    },
    noVendors: 'Every vendor is unchecked, so there is nothing to rank. Enable at least one.',
    urlFallback:
      'Part of the link could not be read and was replaced with defaults. The calculation below is valid, but it may not be the one you were sent.',
    internalError:
      'Something went wrong while rendering the results. The inputs are intact — adjust a parameter to recompute.',
  },

  footer: {
    accuracy: 'Estimates carry a ±25–30% band. Treat them as sizing guidance, not as a measurement.',
    loadTesting: 'This is not a substitute for load testing on your own traffic.',
    pricesAsOf: 'Prices as of {date}.',
    sources: 'Model hyperparameters cite the upstream config.json on Hugging Face.',
    repo: 'Source and issues on GitHub',
    offline: 'The page is fully static: no network calls, no telemetry.',
  },

  deploy: {
    panel: {
      section: 'Deployment',
      hint: 'How this configuration is actually run, on top of what page 1 already sized.',
      pinnedTitle: 'Pricing this configuration',
      pinnedSummary: '{gpus}× {accelerator} · {quant}',
      pinnedChangeHint: 'Change the model, load or hardware on Explore or Verify — this tab prices whatever is pinned there.',
      facility: 'Where it runs',
      facilityHint: 'Colocation and on-premises price a fleet you buy; cloud reuses the rented hourly rate from page 1 and skips hardware capex entirely.',
      region: 'Region',
      regionHint: 'Sets the colocation, electricity and staffing rates. Every rate is editable in the estimate below.',
      availabilityPolicy: 'Redundancy',
      availabilityPolicyHint: 'None means a single replica — losing it takes the service down. N+1 adds a standby replica; dual-site doubles the whole fleet across two locations.',
      staffing: 'Operations coverage',
      staffingHint: '24/7 means a rotating shift, not one engineer on call.',
      horizonYears: 'Planning horizon, years',
      horizonYearsHint: 'Amortization window for capex and the buy-vs-rent comparison.',
      softwarePreset: 'Software & services preset',
      softwarePresetHint: 'A starting point for the gateway, auth, metering, billing and observability stack — every component below can be swapped individually.',
    },
    results: {
      title: 'Turnkey estimate',
      totalsTitle: 'What it costs in money',
      oneTime: 'Up front',
      oneTimeHint: 'Everything paid before the service can serve: cards, chassis, fabric and optics, facility build-out, spares on the shelf, and standing the software stack up.',
      monthly: 'Per month',
      monthlyHint: 'Facility, electricity, vendor support, card replacements, staffing, software subscriptions and traffic.',
      horizonTco: 'Total over {years} yr',
      horizonTcoHint: 'Up front plus every month across the planning horizon, less any residual value. This is the figure a budget gets signed against.',
      buyOver: 'Buy, {years} yr total',
      rentOver: 'Rent, {years} yr total',
      deltaTitle: 'What page 1 showed vs. the full cost',
      page1Label: 'Page 1 estimate',
      fullLabel: 'Full turnkey cost',
      perMillionTokens: 'per 1M tokens',
      priceUnavailable: 'Cannot be priced — see the risks below',
      waterfallTitle: 'Where the rest of the cost comes from',
      breakevenTitle: 'Buy vs. rent',
      breakevenMonths: 'Buying breaks even against renting in about {months} months.',
      breakevenNever: 'Renting stays cheaper across the whole horizon at today’s rates.',
      breakevenBeyondHorizon:
        'That is beyond your {years}-year horizon — over the period you are planning for, renting comes out cheaper.',
      breakevenUnavailable: 'No cloud rental rate on file for this accelerator — cannot compare.',
      topLineTitle: 'Biggest cost lines',
      widestRangeTitle: 'What to confirm first',
      widestRangeHint: 'These lines carry the widest uncertainty — a real quote here narrows the estimate the most.',
      risksTitle: 'Assumptions & risks',
      noRisks: 'Nothing flagged for this configuration.',
      print: 'Print / save as PDF',
    },
    waterfall: {
      page1: 'Page 1 estimate',
      cards: 'Cards',
      'chassis-network': 'Chassis & networking',
      facility: 'Racks, power & facility',
      redundancy: 'Redundancy',
      'staffing-support': 'Staffing, support & replacements',
      software: 'Software & services',
      traffic: 'Traffic',
    },
    facility: {
      colo: 'Colocation',
      'on-prem': 'On-premises',
      cloud: 'Cloud rental',
    },
    region: {
      us: 'US',
      eu: 'EU',
      ru: 'RU',
      apac: 'APAC',
    },
    availabilityPolicy: {
      none: 'None — single replica',
      'n+1': 'N+1',
      'n+1-spare': 'N+1 + spares on shelf',
      'dual-site': 'Dual-site',
    },
    staffing: {
      'business-hours': 'Business hours',
      extended: 'Extended hours',
      '24x7': '24/7',
    },
    softwarePreset: {
      internal: 'Internal tooling',
      commercial: 'Commercial service',
      regulated: 'Regulated industry',
    },
    severity: {
      info: 'Info',
      warning: 'Warning',
      blocking: 'Blocking',
    },
  },

  units: {
    tokensPerSec: 'tok/s',
    tokens: 'tok',
    millionTokens: '1M tok',
    seconds: 's',
    milliseconds: 'ms',
    gib: 'GiB',
    tib: 'TiB',
    gbPerSec: 'GB/s',
    tflops: 'TFLOPS',
    watts: 'W',
    kilowatts: 'kW',
    perHour: '/h',
    perMonth: '/mo',
    requestsPerSec: 'req/s',
    gpus: 'GPU',
    nodes: 'node',
    nodesPlural: 'nodes',
    sessions: 'sessions',
    percent: '%',
    range: '{low}–{high}',
    perGpu: 'per GPU',
  },

  actions: {
    copy: 'Copy',
    copied: 'Copied',
    copyFailed: 'Copy failed — select the text manually',
    expand: 'Expand',
    collapse: 'Collapse',
    showAll: 'Show all',
    close: 'Close',
    openSource: 'Open source',
  },

  enums: {
    quant: {
      bf16: 'BF16',
      fp8: 'FP8',
      int8: 'INT8',
      int4: 'INT4',
    },
    kvQuant: {
      fp16: 'FP16',
      fp8: 'FP8',
      int4: 'INT4',
    },
    vendor: {
      nvidia: 'NVIDIA',
      amd: 'AMD',
      consumer: 'Consumer',
      chinese: 'Chinese',
      'cpu-apple': 'CPU / Apple',
    },
    profile: {
      chat: 'Chat',
      'coding-agent': 'Coding agent',
      rag: 'RAG',
      batch: 'Batch',
      custom: 'Custom',
    },
    profileHint: {
      chat: 'Short prompts, short answers, bursty traffic.',
      'coding-agent': 'Huge prompts against short answers, with a high prefix cache hit rate.',
      rag: 'Retrieved context in front of a medium answer.',
      batch: 'Offline processing where throughput matters and latency does not.',
      custom: 'Your own numbers — the profile presets no longer apply.',
    },
    costMode: {
      buy: 'Buy',
      rent: 'Rent',
      off: 'Off',
    },
    costModeHint: {
      buy: 'Rank by 3-year TCO: hardware plus electricity.',
      rent: 'Rank by cost per 1M output tokens at cloud hourly rates.',
      off: 'Ignore prices and rank by accelerator count. Useful when the price file has gone stale.',
    },
    framework: {
      vllm: 'vLLM',
      sglang: 'SGLang',
    },
    attention: {
      mha: 'MHA',
      gqa: 'GQA',
      mla: 'MLA',
      hybrid: 'Hybrid',
    },
    interconnect: {
      nvlink: 'NVLink',
      xgmi: 'xGMI',
      hccs: 'HCCS',
      pcie: 'PCIe',
      ib400: 'InfiniBand 400G',
      ib200: 'InfiniBand 200G',
      ethernet: 'Ethernet',
      'unified-memory': 'Unified memory',
    },
  },
} as const

export default en
