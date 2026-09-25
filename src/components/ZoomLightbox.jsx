export default function ZoomLightbox({ src, onClose }) {
  return (
    <div
      id="zoom-overlay"
      className={src ? 'open' : ''}
      onClick={(e) => {
        if (e.target.id === 'zoom-overlay') onClose();
      }}
    >
      <button id="zoom-close" title="Close (Esc)" onClick={onClose}>
        ✕
      </button>
      <img id="zoom-img" alt="Zoomed screenshot" src={src} />
    </div>
  );
}
