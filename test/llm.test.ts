import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLedger } from "../src/llm.js";

function usage(prompt: number, completion: number) {
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
  };
}

describe("createLedger", () => {
  it("attributes cost to the stage that spent it", () => {
    const ledger = createLedger();

    ledger.record("score", "gpt-5-mini", usage(20_000, 4_000));
    ledger.record("enrich", "gpt-5.1", usage(30_000, 3_000));

    const stages = ledger.byStage();

    assert.equal(stages.length, 2);
    assert.equal(stages.find((s) => s.stage === "score")!.estimatedCostUsd, 0.013);
    assert.equal(stages.find((s) => s.stage === "enrich")!.estimatedCostUsd, 0.0675);
  });

  it("accumulates repeated calls to one stage", () => {
    const ledger = createLedger();

    ledger.record("score", "gpt-5-mini", usage(1_000, 100));
    ledger.record("score", "gpt-5-mini", usage(1_000, 100));
    ledger.record("score", "gpt-5-mini", usage(1_000, 100));

    const [row] = ledger.byStage();

    assert.equal(row!.calls, 3);
    assert.equal(row!.inputTokens, 3_000);
    assert.equal(row!.outputTokens, 300);
  });

  it("orders stages by what they cost", () => {
    const ledger = createLedger();

    ledger.record("compose", "gpt-5.1", usage(1_000, 100));
    ledger.record("enrich", "gpt-5.1", usage(50_000, 10_000));
    ledger.record("score", "gpt-5-mini", usage(5_000, 500));

    assert.deepEqual(
      ledger.byStage().map((s) => s.stage),
      ["enrich", "compose", "score"],
    );
  });

  it("totals match the sum of the stages", () => {
    const ledger = createLedger();

    ledger.record("score", "gpt-5-mini", usage(20_000, 4_000));
    ledger.record("enrich", "gpt-5.1", usage(30_000, 3_000));

    const totals = ledger.totals();

    assert.equal(totals.inputTokens, 50_000);
    assert.equal(totals.outputTokens, 7_000);
    assert.equal(totals.estimatedCostUsd, 0.0805);
    assert.equal(totals.stages?.length, 2);
  });

  it("flags a model it has no price for instead of charging zero", () => {
    const ledger = createLedger();

    ledger.record("score", "some-new-model", usage(1_000_000, 1_000_000));

    assert.deepEqual(ledger.unpricedModels(), ["some-new-model"]);
    assert.equal(ledger.byStage()[0]!.priced, false);
    assert.equal(ledger.totals().inputTokens, 1_000_000);
  });

  it("prices a pinned snapshot at its base model's rate", () => {
    const ledger = createLedger();

    ledger.record("score", "gpt-5-mini-2025-08-07", usage(1_000_000, 0));

    assert.deepEqual(ledger.unpricedModels(), []);
    assert.equal(ledger.totals().estimatedCostUsd, 0.25);
  });

  it("separates the same stage run on two models", () => {
    const ledger = createLedger();

    ledger.record("enrich", "gpt-5.1", usage(1_000, 100));
    ledger.record("enrich", "gpt-5-mini", usage(1_000, 100));

    assert.equal(ledger.byStage().length, 2);
  });

  it("ignores a response that carried no usage", () => {
    const ledger = createLedger();

    ledger.record("score", "gpt-5-mini", undefined);

    assert.deepEqual(ledger.byStage(), []);
    assert.equal(ledger.totals().estimatedCostUsd, 0);
  });

  it("keeps two ledgers independent", () => {
    const a = createLedger();
    const b = createLedger();

    a.record("score", "gpt-5-mini", usage(1_000, 100));

    assert.equal(b.totals().inputTokens, 0);
    assert.equal(a.totals().inputTokens, 1_000);
  });
});
