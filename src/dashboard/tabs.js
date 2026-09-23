const dashboardTabs = Array.from(document.querySelectorAll('[role="tab"][data-tab]'));

function syncTabFocus() {
  dashboardTabs.forEach((button) => {
    button.tabIndex = button.getAttribute("aria-selected") === "true" ? 0 : -1;
  });
}

function moveTab(event) {
  const currentIndex = dashboardTabs.indexOf(event.currentTarget);
  if (currentIndex < 0) return;

  let nextIndex = currentIndex;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    nextIndex = (currentIndex + 1) % dashboardTabs.length;
  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    nextIndex = (currentIndex - 1 + dashboardTabs.length) % dashboardTabs.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = dashboardTabs.length - 1;
  } else {
    return;
  }

  event.preventDefault();
  const nextTab = dashboardTabs[nextIndex];
  nextTab.click();
  syncTabFocus();
  nextTab.focus();
}

dashboardTabs.forEach((button) => {
  button.addEventListener("keydown", moveTab);
  const observer = new MutationObserver(syncTabFocus);
  observer.observe(button, { attributes: true, attributeFilter: ["aria-selected"] });
});

syncTabFocus();
