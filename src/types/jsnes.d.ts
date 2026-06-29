declare module "jsnes" {
  interface NESOptions {
    onFrame: (frameBuffer: number[]) => void;
    onAudioSample?: (left: number, right: number) => void;
    onStatusUpdate?: (message: string) => void;
    onBatteryRamWrite?: (address: number, value: number) => void;
  }

  interface NES {
    loadROM(romData: string): void;
    reset(): void;
    frame(): void;
    buttonDown(controller: number, button: number): void;
    buttonUp(controller: number, button: number): void;
    getFPS(): number;
    setFrameRate(rate: number): void;
    toJSON(): object;
    fromJSON(state: object): void;
  }

  interface JSNES {
    NES: new (options: NESOptions) => NES;
    Controller: {
      BUTTON_A: number;
      BUTTON_B: number;
      BUTTON_SELECT: number;
      BUTTON_START: number;
      BUTTON_UP: number;
      BUTTON_DOWN: number;
      BUTTON_LEFT: number;
      BUTTON_RIGHT: number;
    };
  }

  const jsnes: JSNES;
  export default jsnes;
}
