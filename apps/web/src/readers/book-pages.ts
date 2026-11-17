import { pageFold, polygon } from "./page-fold";
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
  private animationFrame = 0;
  private finishAnimation?: () => void;
  private origin?: number;
  private target?: number;
  private front?: HTMLElement;
  private back?: HTMLElement;
  private shade?: HTMLElement;
  private topCorner = false;
  private lift = 100;
  get turning() {
    return this.busy || !!this.drag || this.origin !== undefined;
  }

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
        if (this.turning || window.getSelection()?.toString()) return;
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
          this.drag ||
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
        this.topCorner = event.clientY - rect.top < rect.height / 2;
        this.lift = Math.min(rect.height * 0.25, this.pageWidth * 0.45);
        void this.begin(direction).catch((error) => {
          this.cancel();
          failed(error);
        });
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
              (this.pageWidth * 2),
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
          void this.rebound(drag.progress, drag.direction).catch(() =>
            this.cancel(),
          );
      },
      { signal },
    );
    viewport.addEventListener("pointercancel", () => this.cancel(), { signal });
    viewport.addEventListener(
      "lostpointercapture",
      () => {
        if (this.drag) this.cancel();
      },
      { signal },
    );
    window.addEventListener("blur", () => this.cancel(), { signal });
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
  private starting?: Promise<void>;
  private async begin(direction: number) {
    if (this.starting) return this.starting;
    this.starting = this.prepareTurn(direction);
    try {
      await this.starting;
    } finally {
      this.starting = undefined;
    }
  }
  private async prepareTurn(direction: number) {
    const revision = this.revision;
    await this.prepare(direction);
    if (revision !== this.revision) return;
    const current = this.viewport.scrollLeft;
    const target = Math.max(0, current + direction * this.viewport.clientWidth);
    if (target === current || target >= this.flow.scrollWidth - 1) return;
    this.snapshot(direction);
    this.origin = current;
    this.target = target;
    this.viewport.scrollLeft = target;
    if (this.drag) this.curl(this.drag.progress, direction);
  }
  async turn(direction: number, from = 0) {
    if (this.busy) return;
    this.busy = true;
    const revision = this.revision;
    try {
      if (this.origin === undefined) await this.begin(direction);
      if (revision !== this.revision || this.target === undefined) return;
      await this.animate(from, 1, direction);
      if (revision === this.revision) {
        this.origin = undefined;
        this.target = undefined;
        this.clear();
        this.busy = false;
        this.changed();
      }
    } finally {
      if (revision === this.revision) {
        this.clear();
        this.busy = false;
      }
    }
  }
  private async rebound(from: number, direction: number) {
    this.busy = true;
    const revision = this.revision;
    await this.starting;
    if (revision !== this.revision) return;
    await this.animate(from, 0, direction);
    if (revision !== this.revision) return;
    this.cancel();
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
    const style = getComputedStyle(this.viewport);
    const background = style.backgroundColor;
    Object.assign(overlay.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height - 32}px`,
      color: style.color,
    });
    const page = (offset: number) => {
      const leaf = document.createElement("div");
      leaf.className = "book-page-leaf";
      Object.assign(leaf.style, { width: `${this.pageWidth}px`, background });
      const copy = this.flow.cloneNode(true) as HTMLElement;
      copy
        .querySelectorAll("[id]")
        .forEach((node) => node.removeAttribute("id"));
      Object.assign(copy.style, {
        position: "absolute",
        left: `${-this.viewport.scrollLeft - offset}px`,
        top: "0px",
        font: style.font,
        lineHeight: style.lineHeight,
      });
      copy.style.setProperty(
        "--reading-margin",
        this.viewport.style.getPropertyValue("--reading-margin"),
      );
      leaf.append(copy);
      return leaf;
    };
    const offset = direction > 0 ? rect.width - this.pageWidth : 0;
    if (this.columns === 2) {
      const still = page(direction > 0 ? 0 : this.pageWidth);
      still.style.left = `${direction > 0 ? 0 : this.pageWidth}px`;
      overlay.append(still);
    }
    const sheet = document.createElement("div");
    sheet.className = "book-page-sheet";
    Object.assign(sheet.style, {
      left: `${offset}px`,
      width: `${this.pageWidth}px`,
      transform: `scale(${direction},${this.topCorner ? -1 : 1})`,
    });
    this.front = page(offset);
    // Mirror the coordinate system without mirroring the printed side.
    (this.front.firstElementChild as HTMLElement).style.transform =
      `scale(${direction},${this.topCorner ? -1 : 1})`;
    (this.front.firstElementChild as HTMLElement).style.transformOrigin =
      `${this.viewport.scrollLeft + offset + this.pageWidth / 2}px ${(rect.height - 32) / 2}px`;
    this.back = document.createElement("div");
    this.back.className = "book-page-back";
    Object.assign(this.back.style, {
      width: `${this.pageWidth}px`,
      background,
    });
    this.shade = document.createElement("div");
    this.shade.className = "book-page-fold-shadow";
    sheet.append(this.front, this.back, this.shade);
    overlay.append(sheet);
    document.body.append(overlay);
    this.overlay = overlay;
    this.curl(0, direction);
  }
  private curl(progress: number, _direction: number) {
    if (!this.front || !this.back || !this.shade) return;
    const height = Math.max(1, this.viewport.clientHeight - 32);
    const fold = pageFold(this.pageWidth, height, progress, this.lift);
    this.front.style.clipPath = polygon(fold.front);
    this.back.style.clipPath = polygon(fold.back);
    this.back.style.transform = `matrix(${fold.matrix.join(",")})`;
    this.back.style.visibility =
      progress > 0 && progress < 1 ? "visible" : "hidden";
    const strength = Math.sin(Math.PI * progress);
    Object.assign(this.shade.style, {
      left: `${fold.mid.x}px`,
      top: `${fold.mid.y}px`,
      width: `${24 + 24 * strength}px`,
      height: `${Math.hypot(this.pageWidth, height) * 2}px`,
      transform: `translate(-50%,-50%) rotate(${fold.angle}deg)`,
      opacity: String(strength * 0.55),
    });
  }
  private async animate(from: number, to: number, direction: number) {
    if (!this.overlay) return;
    const duration = Math.max(100, 420 * Math.abs(to - from));
    const start = performance.now();
    await new Promise<void>((resolve) => {
      this.finishAnimation = resolve;
      const frame = (now: number) => {
        const time = Math.min(1, (now - start) / duration);
        const eased = 1 - (1 - time) ** 3;
        this.curl(from + (to - from) * eased, direction);
        if (time < 1) this.animationFrame = requestAnimationFrame(frame);
        else {
          this.finishAnimation = undefined;
          resolve();
        }
      };
      this.animationFrame = requestAnimationFrame(frame);
    });
  }
  private clear() {
    cancelAnimationFrame(this.animationFrame);
    this.finishAnimation?.();
    this.finishAnimation = undefined;
    this.overlay?.remove();
    this.overlay = undefined;
    this.front = this.back = this.shade = undefined;
  }
  cancel() {
    this.revision++;
    if (this.origin !== undefined) this.viewport.scrollLeft = this.origin;
    this.origin = this.target = undefined;
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
