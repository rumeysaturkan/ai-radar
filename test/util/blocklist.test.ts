import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isBlockedSource } from "../../src/util/blocklist.js";

describe("isBlockedSource", () => {
  it("blocks social platforms", () => {
    for (const url of [
      "https://www.linkedin.com/posts/someone_something",
      "https://twitter.com/x/status/1",
      "https://x.com/x/status/1",
      "https://www.reddit.com/r/cycling/comments/1",
      "https://youtube.com/watch?v=1",
    ]) {
      assert.equal(isBlockedSource(url), true, `${url} should be blocked`);
    }
  });

  it("blocks subdomains of a blocked host", () => {
    assert.equal(isBlockedSource("https://uk.linkedin.com/in/x"), true);
    assert.equal(isBlockedSource("https://en.wikipedia.org/wiki/Cycling"), true);
  });

  it("lets real publications through", () => {
    for (const url of [
      "https://cyclingtips.com/2026/09/article",
      "https://velo.outsideonline.com/x",
      "https://arstechnica.com/feed",
      "https://news.ycombinator.com/item?id=1",
    ]) {
      assert.equal(isBlockedSource(url), false, `${url} should pass`);
    }
  });

  it("does not block a host that merely ends in a blocked word", () => {
    assert.equal(isBlockedSource("https://notx.com/a"), false);
    assert.equal(isBlockedSource("https://mygoogle.com/a"), false);
  });
});
