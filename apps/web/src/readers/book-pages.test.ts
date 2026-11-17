// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { BookPages } from "./book-pages";

const instances: BookPages[] = [];
afterEach(() => {
  instances.forEach((instance) => instance.destroy());
  instances.length = 0;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
function create(width = 800) {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const host = document.createElement("div");
  const paragraph = document.createElement("p");
  paragraph.textContent = "原文与批注应保留同一个节点";
  host.append(paragraph);
  document.body.append(host);
  Object.defineProperties(host, {
    clientWidth: { value: width, configurable: true },
    clientHeight: { value: 600 },
  });
  const changed = vi.fn();
  const pages = new BookPages(host, async () => {}, changed, vi.fn());
  Object.defineProperty(pages.flow, "scrollWidth", { value: 2400 });
  instances.push(pages);
  return { host, paragraph, pages, changed };
}
it("retains source nodes across flow changes and uses spread-sized navigation", async () => {
  const { host, paragraph, pages, changed } = create();
  expect(pages.columns).toBe(2);
  expect(pages.flow.firstChild).toBe(paragraph);
  await pages.turn(1);
  expect(host.scrollLeft).toBe(800);
  await pages.turn(-1);
  expect(host.scrollLeft).toBe(0);
  await pages.turn(-1);
  expect(changed).toHaveBeenCalledTimes(2);
  pages.destroy();
  expect(host.firstChild).toBe(paragraph);
});
it("coalesces queued navigation and cancels it on a layout change", async () => {
  const { host, pages, changed } = create(600);
  const first = pages.turn(1);
  const second = pages.turn(1);
  pages.cancel();
  await Promise.all([first, second]);
  expect(host.scrollLeft).toBe(0);
  expect(changed).not.toHaveBeenCalled();
  expect(pages.columns).toBe(1);
});
it("does not turn a page while editing text", async () => {
  const { host, pages } = create();
  const input = document.createElement("input");
  pages.flow.append(input);
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
  );
  await Promise.resolve();
  expect(host.scrollLeft).toBe(0);
});
