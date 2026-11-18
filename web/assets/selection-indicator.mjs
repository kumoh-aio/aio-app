export function measureIndicator(container, target, borders, previous = null) {
  if (container.width <= 0 || target.width <= 0) return null;

  const left = target.left - container.left - borders.left;
  const right = container.right - borders.right - target.right;
  const direction = previous && left - right < previous.left - previous.right
    ? "back"
    : "forward";
  return { left, right, direction };
}

export function createSelectionIndicator(container, buttons) {
  const win = container?.ownerDocument?.defaultView;
  let selected = null;
  let position = null;

  function update(button, animate = false) {
    place(button, animate, false);
  }

  function place(button, animate, layoutOnly) {
    if (!win || !button) return;
    const sameButton = selected === button;
    selected = button;
    if (animate && sameButton && position) return;

    const style = win.getComputedStyle(container);
    const next = measureIndicator(container.getBoundingClientRect(), button.getBoundingClientRect(), {
      left: parseFloat(style.borderLeftWidth) || 0,
      right: parseFloat(style.borderRightWidth) || 0,
    }, position);
    if (!next) {
      position = null;
      container.removeAttribute("data-indicator");
      return;
    }
    if (sameButton && position) {
      if (layoutOnly && next.left === position.left && next.right === position.right) return;
      next.direction = position.direction;
    }
    const transition = animate && position;
    if (!transition) container.setAttribute("data-indicator", "instant");
    container.style.setProperty("--indicator-left", `${next.left}px`);
    container.style.setProperty("--indicator-right", `${next.right}px`);
    container.setAttribute("data-indicator-dir", next.direction);
    if (!transition) {
      // Commit the non-transitioning position before enabling future transitions.
      win.getComputedStyle(container, "::before").left;
      container.setAttribute("data-indicator", "ready");
    }
    position = next;
  }

  const realign = () => place(selected, false, true);
  if (win?.ResizeObserver) {
    const observer = new win.ResizeObserver(realign);
    observer.observe(container);
    for (const button of buttons) observer.observe(button);
  } else {
    win?.addEventListener("resize", realign);
  }
  return update;
}
