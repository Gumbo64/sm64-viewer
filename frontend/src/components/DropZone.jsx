import { useRef, useState } from 'react';

/** A click-or-drop file target. */
export default function DropZone({ accept, onFile, label, compact = false }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);

  const pick = (files) => {
    if (files && files[0]) onFile(files[0]);
  };

  return (
    <div
      className={`dropzone${over ? ' over' : ''}${compact ? ' compact' : ''}`}
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        pick(e.dataTransfer.files);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
    >
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          pick(e.target.files);
          e.target.value = '';
        }}
      />
      {label}
    </div>
  );
}
