export default function AudioPlayer({ track, lang }) {
  const title = lang === 'zh' ? (track.title_zh || track.title) : (track.title || track.title_zh);
  return (
    <div className="audio-player-row">
      <div className="audio-player-title">{title}</div>
      <audio controls preload="none" src={track.url} className="audio-player-el" />
    </div>
  );
}
