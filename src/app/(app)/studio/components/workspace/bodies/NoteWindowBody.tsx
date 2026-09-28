"use client";

export function NoteWindowBody({
  body,
  onChange,
  onBlur,
}: {
  body: string;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  return (
    <textarea
      aria-label="Note"
      value={body}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      className="h-full w-full resize-none bg-transparent p-3 text-[12px] leading-5 text-white/85 outline-none"
      placeholder="Write a note"
    />
  );
}
