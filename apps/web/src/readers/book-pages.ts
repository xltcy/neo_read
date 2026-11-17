/** Horizontal CSS fragmentation keeps the source DOM and its UTF-16 ranges intact. */
export class BookPages {
  readonly flow = document.createElement("div");
  private footer = document.createElement("output");
  private abort = new AbortController();
  private overlay?: HTMLElement;
  private drag?: {
    x: number;
    direction: number;
    progress: number;
    pointer: number;
  };
  private busy = false;
  private revision = 0;
  private animations: Animation[] = [];

  constructor(
    readonly viewport: HTMLElement,
    private prepare: (direction: number) => Promise<void>,
    private changed: () => void,
    private failed: (error: unknown) => void,
  ) {
    const original = [...viewport.childNodes];
    this.flow.className = "book-page-flow";
    this.flow.append(...original);
    viewport.append(this.flow);
    viewport.classList.add("book-pages");
    viewport.scrollTop = 0;
    this.footer.className = "book-page-progress";
    this.footer.setAttribute("aria-live", "polite");
    viewport.parentElement?.append(this.footer);
    const signal = this.abort.signal;
    viewport.addEventListener(
      "keydown",
      (event) => {
        if (
          event.defaultPrevented ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          event.isComposing ||
          this.interactive(event.target)
        )
          return;
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        if (window.getSelection()?.toString()) return;
        event.preventDefault();
        void this.turn(event.key === "ArrowRight" ? 1 : -1).catch(failed);
      },
      { signal },
    );
    viewport.addEventListener(
      "pointerdown",
      (event) => {
        if (
          event.button !== 0 ||
          this.busy ||
          this.interactive(event.target) ||
          window.getSelection()?.toString()
        )
          return;
        const rect = viewport.getBoundingClientRect();
        const x = event.clientX - rect.left;
        if (x > 32 && x < rect.width - 32) return;
        event.preventDefault();
        const direction = x < 32 ? -1 : 1;
        this.drag = {
          x: event.clientX,
          direction,
          progress: 0,
          pointer: event.pointerId,
        };
        viewport.setPointerCapture(event.pointerId);
        this.snapshot(direction);
      },
      { signal },
    );
    viewport.addEventListener(
      "pointermove",
      (event) => {
        if (!this.drag || event.pointerId !== this.drag.pointer) return;
        this.drag.progress = Math.max(
          0,
          Math.min(
            1,
            ((this.drag.x - event.clientX) * this.drag.direction) /
              this.pageWidth,
          ),
        );
        this.curl(this.drag.progress, this.drag.direction);
      },
      { signal },
    );
    viewport.addEventListener(
      "pointerup",
      (event) => {
        const drag = this.drag;
        if (!drag || event.pointerId !== drag.pointer) return;
        this.drag = undefined;
        viewport.releasePointerCapture(event.pointerId);
        const click = Math.abs(event.clientX - drag.x) < 5;
        if (click || drag.progress >= 0.5)
          void this.turn(drag.direction, drag.progress).catch(failed);
        else
          void this.animate(drag.progress, 0, drag.direction).then(() =>
            this.clear(),
          );
      },
      { signal },
    );
    viewport.addEventListener("pointercancel", () => this.cancel(), { signal });
    this.layout();
  }
  private interactive(target: EventTarget | null) {
    return (
      target instanceof Element &&
      !!target.closest(
        "a,button,input,textarea,select,[contenteditable],pre,table,[role=dialog]",
      )
    );
  }
  get columns() {
    return this.viewport.clientWidth >= 720 ? 2 : 1;
  }
  get pageWidth() {
    return this.viewport.clientWidth / this.columns;
  }
  layout() {
    this.cancel();
    this.flow.style.setProperty(
      "--book-page-height",
      `${Math.max(1, this.viewport.clientHeight - 64)}px`,
    );
    this.flow.style.height = `${Math.max(1, this.viewport.clientHeight - 32)}px`;
    this.flow.style.columnWidth = `${Math.max(1, this.pageWidth)}px`;
    this.flow.style.width = `${Math.max(1, this.viewport.clientWidth)}px`;
    this.flow.removeAttribute("data-pad-spread");
    const count = Math.ceil(
      this.flow.scrollWidth / Math.max(1, this.pageWidth),
    );
    if (this.columns === 2 && count % 2 === 1)
      this.flow.dataset.padSpread = "true";
  }
  jump(left: number) {
    const width = this.viewport.clientWidth;
    if (width)
      this.viewport.scrollLeft = Math.max(
        0,
        Math.floor((left + 1) / width) * width,
      );
  }
  async turn(direction: number, from = 0) {
    if (this.busy) return;
    this.busy = true;
    const revision = this.revision;
    try {
      await this.prepare(direction);
      if (revision !== this.revision) return;
      const width = this.viewport.clientWidth;
      const current = this.viewport.scrollLeft;
      const target = Math.max(0, current + direction * width);
      if (target === current || target >= this.flow.scrollWidth - 1) return;
      if (!this.overlay) this.snapshot(direction);
      this.viewport.scrollLeft = target;
      await this.animate(from, 1, direction);
      if (revision === this.revision) this.changed();
    } finally {
      if (revision === this.revision) {
        this.clear();
        this.busy = false;
      }
    }
  }
  progress(chapter: HTMLElement) {
    const view = this.viewport.getBoundingClientRect();
    const rects = [...chapter.getClientRects()];
    if (!rects.length || !this.pageWidth) return;
    const first =
      Math.min(...rects.map((r) => r.left)) -
      view.left +
      this.viewport.scrollLeft;
    const last =
      Math.max(...rects.map((r) => r.right)) -
      view.left +
      this.viewport.scrollLeft;
    const page = Math.max(
      1,
      Math.floor((this.viewport.scrollLeft - first) / this.pageWidth) + 1,
    );
    const total = Math.max(1, Math.ceil((last - first) / this.pageWidth));
    this.footer.textContent = `本章第 ${page} 页 / 共 ${total} 页`;
  }
  private snapshot(direction: number) {
    this.clear();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const overlay = document.createElement("div");
    overlay.className = "book-page-curl";
    overlay.setAttribute("aria-hidden", "true");
    overlay.inert = true;
    const rect = this.viewport.getBoundingClientRect();
    Object.assign(overlay.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      color: getComputedStyle(this.viewport).color,
    });
    const background = getComputedStyle(this.viewport).backgroundColor;
    const offset = direction > 0 ? rect.width - this.pageWidth : 0;
    for (let i = 0; i < 16; i++) {
      const strip = document.createElement("div");
      strip.className = "book-page-strip";
      const slice = this.pageWidth / 16;
      Object.assign(strip.style, {
        left: `${offset + i * slice}px`,
        width: `${slice + 1}px`,
        background,
      });
      const copy = this.flow.cloneNode(true) as HTMLElement;
      copy
        .querySelectorAll("[id]")
        .forEach((node) => node.removeAttribute("id"));
      Object.assign(copy.style, {
        position: "absolute",
        left: `${-this.viewport.scrollLeft - offset - i * slice}px`,
        top: "0px",
        font: getComputedStyle(this.viewport).font,
        lineHeight: getComputedStyle(this.viewport).lineHeight,
      });
      copy.style.setProperty(
        "--reading-margin",
        this.viewport.style.getPropertyValue("--reading-margin"),
      );
      strip.append(copy);
      overlay.append(strip);
    }
    document.body.append(overlay);
    this.overlay = overlay;
  }
  private curl(progress: number, direction: number) {
    if (!this.overlay) return;
    [...this.overlay.children].forEach((node, index) => {
      const strip = node as HTMLElement;
      const phase = direction > 0 ? index / 15 : 1 - index / 15;
      const angle = Math.min(
        180,
        Math.max(0, progress * 210 - (1 - phase) * 30),
      );
      const bend = Math.sin((angle * Math.PI) / 180);
      strip.style.transform = `translateX(${-direction * progress * this.pageWidth}px) translateZ(${bend * 55}px) rotateY(${-direction * angle}deg)`;
      (strip.firstElementChild as HTMLElement).style.visibility =
        angle > 90 ? "hidden" : "visible";
      strip.style.filter = `brightness(${1 - bend * 0.18})`;
    });
  }
  private async animate(from: number, to: number, direction: number) {
    if (!this.overlay) return;
    this.curl(from, direction);
    const starts = [...this.overlay.children].map(
      (node) => (node as HTMLElement).style.transform,
    );
    this.curl(to, direction);
    this.animations = [...this.overlay.children].map((node, i) =>
      node.animate(
        [
          { transform: starts[i] },
          { transform: (node as HTMLElement).style.transform },
        ],
        {
          duration: 350 * Math.abs(to - from),
          easing: "ease-out",
          fill: "forwards",
        },
      ),
    );
    await Promise.all(
      this.animations.map((animation) => animation.finished.catch(() => {})),
    );
  }
  private clear() {
    this.animations.forEach((animation) => animation.cancel());
    this.animations = [];
    this.overlay?.remove();
    this.overlay = undefined;
  }
  cancel() {
    this.revision++;
    if (this.drag && this.viewport.hasPointerCapture(this.drag.pointer))
      this.viewport.releasePointerCapture(this.drag.pointer);
    this.drag = undefined;
    this.busy = false;
    this.clear();
  }
  destroy() {
    this.cancel();
    this.abort.abort();
    this.footer.remove();
    this.flow.replaceWith(...this.flow.childNodes);
    this.viewport.classList.remove("book-pages");
    this.viewport.scrollLeft = 0;
  }
}
