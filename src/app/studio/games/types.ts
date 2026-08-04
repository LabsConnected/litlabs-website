export type GameStatus = "original" | "inspired" | "opensource" | "licensed";

export interface GameMeta {
  id: string;
  title: string;
  brandTitle?: string;
  description: string;
  tagline?: string;
  category: "cards" | "puzzle" | "word";
  players: string;
  color: string;
  icon: string;
  coverImage?: string;
  status: GameStatus;
  sourceAttribution?: string;
  controlsHint?: string;
}

export interface GameShellProps {
  gameId: string;
  children: React.ReactNode;
  title: string;
  onReset: () => void;
  onHelp: () => void;
}
