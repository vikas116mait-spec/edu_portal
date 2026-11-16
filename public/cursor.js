(() => {
  const finePointer = window.matchMedia(
    "(hover: hover) and (pointer: fine)",
  );
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  if (!finePointer.matches || reducedMotion.matches) return;

  const cursor = document.createElement("div");
  cursor.className = "cursor-follower";
  cursor.setAttribute("aria-hidden", "true");
  cursor.innerHTML = [
    '<span class="cursor-follower-glow"></span>',
    '<span class="cursor-follower-ring"></span>',
    '<span class="cursor-follower-core"></span>',
  ].join("");
  document.body.append(cursor);
  document.body.classList.add("has-animated-cursor");

  const controller = new AbortController();
  const listenerOptions = { signal: controller.signal };
  let targetX = window.innerWidth / 2;
  let targetY = window.innerHeight / 2;
  let currentX = targetX;
  let currentY = targetY;
  let animationFrame = 0;
  let clickTimer = 0;

  function followPointer() {
    currentX += (targetX - currentX) * 0.2;
    currentY += (targetY - currentY) * 0.2;
    cursor.style.transform =
      `translate3d(${currentX}px, ${currentY}px, 0) translate(-50%, -50%)`;

    if (Math.hypot(targetX - currentX, targetY - currentY) > 0.2) {
      animationFrame = requestAnimationFrame(followPointer);
    } else {
      animationFrame = 0;
    }
  }

  window.addEventListener("pointermove", (event) => {
    targetX = event.clientX;
    targetY = event.clientY;
    cursor.classList.add("is-visible");
    if (!animationFrame) animationFrame = requestAnimationFrame(followPointer);
  }, { ...listenerOptions, passive: true });

  function hideCursor() {
    cursor.classList.remove("is-visible", "is-interactive");
  }

  document.documentElement.addEventListener(
    "pointerleave",
    hideCursor,
    listenerOptions,
  );
  window.addEventListener("blur", hideCursor, listenerOptions);

  document.addEventListener("pointerover", (event) => {
    if (!(event.target instanceof Element)) return;
    const interactive = event.target.closest(
      "a, button, input, select, textarea, label, [role=button]",
    );
    cursor.classList.toggle("is-interactive", Boolean(interactive));
  }, listenerOptions);

  document.addEventListener("pointerdown", (event) => {
    if (event.button === 0) cursor.classList.add("is-down");
  }, listenerOptions);
  window.addEventListener("pointerup", (event) => {
    if (event.button !== 0) return;
    cursor.classList.remove("is-down");
    cursor.classList.add("is-clicking");
    window.clearTimeout(clickTimer);
    clickTimer = window.setTimeout(() => {
      cursor.classList.remove("is-clicking");
    }, 480);
  }, listenerOptions);

  function disableForReducedMotion(event) {
    if (!event.matches) return;
    controller.abort();
    window.cancelAnimationFrame(animationFrame);
    window.clearTimeout(clickTimer);
    cursor.remove();
    document.body.classList.remove("has-animated-cursor");
    reducedMotion.removeEventListener("change", disableForReducedMotion);
  }

  reducedMotion.addEventListener("change", disableForReducedMotion);
})();
