// Type declarations for the <model-viewer> web component.
// This is a pre-existing dependency used by AgentModelViewer.tsx.
// See: https://modelviewer.dev/

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          poster?: string;
          alt?: string;
          "camera-controls"?: boolean;
          "auto-rotate"?: boolean;
          "shadow-intensity"?: number;
          "ar"?: boolean;
          "interaction-prompt"?: string;
          "reveal"?: string;
        },
        HTMLElement
      >;
    }
  }
}

export {};
