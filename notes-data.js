/*
 * ============================================================================
 *  笔记数据 / Notes data
 * ============================================================================
 *
 *  这里是整个笔记库的唯一数据源。要新增一篇笔记，只需向下面的 NOTES 数组
 *  里加一个对象即可。字段说明：
 *
 *    id        必填，唯一短标识（kebab-case），用于 URL（#/note/<id>）。
 *    title     必填，笔记标题。
 *    date      必填，记录日期，格式 "YYYY-MM-DD"。
 *    category  可选，分类徽章文字，如 "RFC" / "设计" / "随笔"。
 *    tags      可选，字符串数组，用于过滤与展示。
 *    summary   可选，一句话摘要，显示在首页卡片上。
 *    source    可选，原始链接（如 Google Doc），显示在文章头部。
 *    content   必填，正文，使用 Markdown 语法。
 *
 *  关于 content：建议用反引号模板字符串书写。正文里如果出现行内代码
 *  （Markdown 的 `code`），需要把反引号转义为 \` 。
 *
 *  支持的 Markdown：# 标题、**粗体**、*斜体*、`行内代码`、```代码块```、
 *  - 无序/1. 有序列表、> 引用、[链接](url)、表格、--- 分隔线。
 * ============================================================================
 */

const NOTES = [
  {
    id: "block-diffusion-engine-kv-v3",
    title: "RFC: Block Diffusion Engine — Chunk-Window KV 管理设计 (v3)",
    date: "2026-05-28",
    category: "RFC",
    tags: ["vLLM", "Diffusion", "KV Cache", "Inference", "World Model"],
    summary:
      "通过一层兼容适配，将 vLLM 原生的 KV cache 管理接入 vLLM-Omni 的扩散步引擎 —— ChunkWindowSpec、BDERequestAdapter 与 chunk 粒度的窗口淘汰策略。",
    source:
      "https://docs.google.com/document/d/1bcH9fHSgGV7WF75sLgFP_AsugHFHUG66NbiPy5Mp_lQ/edit",
    content: `## Document Summary

This RFC proposes integrating vLLM's native KV cache management into vLLM-Omni's diffusion step engine through a compatibility layer, rather than building separate diffusion-specific mechanisms.

## Core Design Approach

The proposal establishes "one World Model Session = one DiffusionRequestState + one vLLM Request adapter." Rather than reimplementing KV management, the design extends the diffusion engine to call vLLM's existing KVCacheManager, BlockPool, and paged attention infrastructure with \`causal=False\` to support bidirectional attention within chunks.

## Key Components

**ChunkWindowSpec** extends vLLM's SlidingWindowSpec with chunk-aware parameters:

- \`chunk_size\`: tokens per chunk
- \`window_chunks\`: visible chunks in active window
- \`eviction_strategy\`: sliding or reset modes

**BDERequestAdapter** bridges DiffusionRequestState to vLLM's KV allocation interface, providing required fields like \`num_computed_tokens\` (completed chunks × chunk_size) and token/hash lists for prefix cache support.

**ChunkWindowManager** inherits SlidingWindowManager but overrides \`get_num_skipped_tokens()\` to operate at chunk boundaries rather than individual tokens.

## Eviction Strategies

**Sliding mode**: preserves the most recent K-1 completed chunks plus the next allocation target, discarding oldest chunks as new ones arrive.

**Reset mode**: clears entire window cycles at boundaries (e.g., "C0-C4 | reset | C5-C9").

## Multi-Step Denoising (T>1)

The same chunk's multiple refinement steps reuse identical slot allocations; only after chunk completion does \`num_computed_tokens\` increment, preventing KV capacity inflation.

## Phased Implementation

- **Step 0** (2 weeks): vLLM compatibility layer with ChunkWindowSpec, BDERequestAdapter, and allocation hooks
- **Step 1** (3 weeks): BlockTables integration and paged attention with sliding/reset eviction
- **Step 2** (3 weeks): T>1 support, cross-session prefix caching, and optional BlockPool prioritization`,
  },
];

// 让 app.js 能在不同环境下读到数据
if (typeof window !== "undefined") {
  window.NOTES = NOTES;
}
