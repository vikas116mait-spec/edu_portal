(() => {
  const choices = [
    { id: "atlas", name: "Atlas Studio", color: "#364de7" },
    { id: "onepot", name: "Onepot Studio", color: "#f3f0e7" },
  ];
  const select = document.querySelector("#theme-picker");
  const storageKey = "cs-core-portal-theme";
  if (!select) return;

  select.innerHTML = choices.map((choice) =>
    '<option value="' + choice.id + '">' + choice.name + '</option>',
  ).join("");

  let savedTheme = "atlas";
  try {
    const storedTheme = window.localStorage.getItem(storageKey);
    if (choices.some((choice) => choice.id === storedTheme)) {
      savedTheme = storedTheme;
    }
  } catch (error) {
    // Theme selection still works for this visit when storage is unavailable.
  }

  function applyTheme(themeId) {
    const choice = choices.find((item) => item.id === themeId) || choices[0];
    document.documentElement.dataset.theme = choice.id;
    select.value = choice.id;
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      "content",
      choice.color,
    );
  }

  applyTheme(savedTheme);
  select.addEventListener("change", () => {
    applyTheme(select.value);
    try {
      window.localStorage.setItem(storageKey, select.value);
    } catch (error) {
      // Keep the selected theme active for this page when storage is unavailable.
    }
  });
})();
