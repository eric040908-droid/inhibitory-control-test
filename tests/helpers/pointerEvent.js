// jsdom 25에는 PointerEvent가 없다. 학생 화면 테스트는 pointerdown/pointerup을 PointerEvent로 쏘므로,
// MouseEvent를 확장한 최소 대역을 전역에 둔다 (이미 있으면 건드리지 않는다).
if (typeof globalThis.PointerEvent === 'undefined') {
  class PointerEvent extends MouseEvent {
    constructor(type, init = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'touch';
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  globalThis.PointerEvent = PointerEvent;
}
