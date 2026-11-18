const settings = {
  color: { key: "aio.appearance.color.v1", values: ["system", "light", "dark"] },
  effect: { key: "aio.appearance.effect.v1", values: ["basic", "neumorphic"] },
};

const themeColors = { light: "#F5F8FC", dark: "#0B1626" };

function restore(storage, { key, values }) {
  try {
    const value = storage?.getItem(key);
    if (values.includes(value)) return value;
  } catch {
    // 저장소를 읽을 수 없으면 기본값으로 시작한다.
  }
  return values[0];
}

export function mountAppearance({ doc, storage }) {
  const selected = {
    color: restore(storage, settings.color),
    effect: restore(storage, settings.effect),
  };
  const root = doc.documentElement;
  const inputs = doc.querySelectorAll("input[data-appearance]");
  const meta = doc.querySelectorAll('meta[name="theme-color"]');

  function render() {
    root.setAttribute("data-color-mode", selected.color);
    if (selected.effect === "neumorphic") root.setAttribute("data-theme", "neumorphic");
    else root.removeAttribute("data-theme");

    const system = selected.color === "system";
    for (const [index, theme] of ["light", "dark"].entries()) {
      meta[index].setAttribute("content", themeColors[system ? theme : selected.color]);
      meta[index].setAttribute("media", system ? `(prefers-color-scheme: ${theme})` : "all");
    }

    for (const input of inputs) {
      input.checked = selected[input.getAttribute("data-appearance")] === input.value;
      input.setAttribute("aria-checked", String(input.checked));
    }
  }

  for (const input of inputs) {
    const kind = input.getAttribute("data-appearance");
    input.addEventListener("change", () => {
      if (!input.checked) return;
      selected[kind] = input.value;
      render();
      try {
        storage?.setItem(settings[kind].key, input.value);
      } catch {
        // 저장에 실패해도 이번 화면에서는 선택을 유지한다.
      }
    });
  }

  render();
}
