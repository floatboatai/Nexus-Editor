function toolbarButtonFromEvent(event: Event, toolbar: HTMLElement): HTMLButtonElement | null {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const button = target.closest<HTMLButtonElement>("button.nexus-toolbar-btn");
  return button && toolbar.contains(button) ? button : null;
}

export function installToolbarNavigation(
  toolbar: HTMLElement,
  buttons: HTMLButtonElement[],
): () => void {
  let activeIndex = 0;

  const setActive = (index: number, moveFocus: boolean) => {
    if (buttons.length === 0) return;
    activeIndex = index;
    buttons.forEach((button, buttonIndex) => {
      button.tabIndex = buttonIndex === activeIndex ? 0 : -1;
    });
    if (moveFocus) buttons[activeIndex]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    const button = toolbarButtonFromEvent(event, toolbar);
    if (!button) return;
    const currentIndex = buttons.indexOf(button);
    if (currentIndex < 0) return;

    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % buttons.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = buttons.length - 1;
    }

    if (nextIndex === null) return;
    event.preventDefault();
    setActive(nextIndex, true);
  };

  const handleFocus = (event: FocusEvent) => {
    const button = toolbarButtonFromEvent(event, toolbar);
    if (!button) return;
    const index = buttons.indexOf(button);
    if (index >= 0) setActive(index, false);
  };

  const handleClick = (event: MouseEvent) => {
    const button = toolbarButtonFromEvent(event, toolbar);
    if (!button) return;
    const index = buttons.indexOf(button);
    if (index >= 0) setActive(index, false);
  };

  setActive(0, false);
  toolbar.addEventListener("keydown", handleKeyDown);
  toolbar.addEventListener("focusin", handleFocus);
  toolbar.addEventListener("click", handleClick, true);

  return () => {
    toolbar.removeEventListener("keydown", handleKeyDown);
    toolbar.removeEventListener("focusin", handleFocus);
    toolbar.removeEventListener("click", handleClick, true);
  };
}
