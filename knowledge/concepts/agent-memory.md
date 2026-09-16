# Agent Memory

## Overview

Agent memory refers to the capability of an AI system to store, recall, and
utilize past experiences to improve its decision-making, perception, and overall
performance across interactions. This distinguishes it from stateless systems
that treat each interaction independently.

## Known Approaches

- Short-term context
- Long-term memory
- Retrieval-based memory (RAG)

## Types of Agent Memory

AI agent memory is classified similarly to human memory:

- **Short-term memory (STM):** Retains recent inputs for immediate
  decision-making within a session. Typically implemented using a context window
  or rolling buffer; useful for maintaining context during interactions but not
  beyond a session.

- **Long-term memory (LTM):** Stores information across sessions for
  personalization and improved intelligence, often using databases, knowledge
  graphs, or vector embeddings. Retrieval Augmented Generation (RAG) is a key
  technique for utilizing LTM.

- **Episodic memory:** Enables recalling specific past events or experiences,
  aiding case-based reasoning and adaptability across scenarios.

- **Semantic memory:** Stores structured factual knowledge for reasoning,
  typically implemented with knowledge bases or vector embeddings. Critical for
  domains requiring expertise, such as legal or medical diagnostics.

- **Procedural memory:** Stores and recalls automated skills or behaviors,
  enabling efficient task execution without explicit reasoning each time.

## Importance

Memory is essential for goal-oriented applications, enabling feedback loops,
adaptive learning, and pattern recognition over time.

## Challenges

The main challenge is optimizing for retrieval efficiency: excessive data
storage can slow processing, so efficient memory management is key to
maintaining the low latency needed for real-time applications.

## Related Concepts

- RAG
- Context Engineering

## Sources

No sources yet.
