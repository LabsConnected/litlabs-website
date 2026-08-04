export interface GameMeta {
  id: string;
  title: string;
  description: string;
  category: "cards" | "puzzle" | "word";
  players: string;
  color: string;
  icon: string;
}

export interface GameShellProps {
  gameId: string;
  children: React.ReactNode;
  title: string;
  onReset: () => void;
  onHelp: () => void;
}
