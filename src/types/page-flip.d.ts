// page-flip 2.x ships no type declarations; this covers the API PageTurn uses.
declare module "page-flip" {
  export type FlippingState = "user_fold" | "fold_corner" | "flipping" | "read";
  export type FlipCorner = "top" | "bottom";

  export class PageFlip {
    constructor(element: HTMLElement, settings: Record<string, unknown>);
    destroy(): void;
    flipNext(corner?: FlipCorner): void;
    flipPrev(corner?: FlipCorner): void;
    flip(page: number, corner?: FlipCorner): void;
    turnToPage(page: number): void;
    getCurrentPageIndex(): number;
    getPageCount(): number;
    getState(): FlippingState;
    getOrientation(): "portrait" | "landscape";
  }
}
