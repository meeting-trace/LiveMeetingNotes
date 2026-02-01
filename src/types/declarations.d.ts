// Type declarations for modules without official types
declare module 'recordrtc' {
  export default RecordRTC;

  class RecordRTC {
    constructor(stream: MediaStream, options: RecordRTCOptions);
    startRecording(): void;
    stopRecording(callback: () => void): void;
    getBlob(): Blob;
    static StereoAudioRecorder: any;
  }

  interface RecordRTCOptions {
    type: string;
    mimeType: string;
    recorderType?: any;
    numberOfAudioChannels?: number;
    desiredSampRate?: number;
    disableLogs?: boolean;
  }
}

declare module '*.css' {
  const content: { [className: string]: string };
  export default content;
}

declare module 'quill' {
  export default Quill;

  class Quill {
    constructor(container: Element, options?: QuillOptions);
    on(eventName: string, handler: (...args: any[]) => void): void;
    getText(): string;
    getSelection(focus?: boolean): { index: number; length: number } | null;
    insertText(index: number, text: string, formats?: any): void;
    setSelection(index: number, length: number): void;
    root: HTMLElement;
  }

  interface QuillOptions {
    theme?: string;
    modules?: any;
    placeholder?: string;
  }
}

declare module 'quill/dist/quill.snow.css';

declare module 'file-saver' {
  export function saveAs(blob: Blob, filename: string): void;
}

declare module 'docx' {
  export class Document {
    constructor(options: any);
  }
  export class Paragraph {
    constructor(options: any);
  }
  export class TextRun {
    constructor(options: any);
  }
  export const HeadingLevel: any;
  export const AlignmentType: any;
  export class Packer {
    static toBlob(doc: Document): Promise<Blob>;
  }
}

// VitePWA virtual module
declare module 'virtual:pwa-register' {
  export interface RegisterSWOptions {
    immediate?: boolean;
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
    onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void;
    onRegisterError?: (error: any) => void;
  }
  
  export function registerSW(options?: RegisterSWOptions): (reloadPage?: boolean) => Promise<void>;
}
