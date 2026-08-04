/** Fullscreen image lightbox for live-preview images. */

export function openImagePreview(src: string, alt = ""): void {
  document.querySelectorAll(".nx-image-lightbox").forEach((el) => el.remove());

  const backdrop = document.createElement("div");
  backdrop.className = "nx-image-lightbox";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");
  backdrop.setAttribute("aria-label", alt || "Image preview");

  const img = document.createElement("img");
  img.src = src;
  img.alt = alt;
  img.className = "nx-image-lightbox__img";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "nx-image-lightbox__close nx-btn nx-btn--icon";
  closeBtn.setAttribute("aria-label", "Close preview");
  closeBtn.innerHTML = "&times;";

  const caption = document.createElement("div");
  caption.className = "nx-image-lightbox__caption";
  caption.textContent = alt;

  backdrop.append(closeBtn, img);
  if (alt) backdrop.appendChild(caption);
  document.body.appendChild(backdrop);

  const close = () => {
    document.removeEventListener("keydown", onKey);
    backdrop.remove();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };

  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    close();
  });
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener("keydown", onKey);
  requestAnimationFrame(() => backdrop.classList.add("is-open"));
}
