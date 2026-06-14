(function () {
  const GRAPH_KEY = "wikiMapGraph";
  const SETTINGS_KEY = "wikiMapSettings";
  const PANEL_ID = "wiki-map-panel";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const DEFAULT_WIDTH = 380;
  const MIN_WIDTH = 280;
  const MAX_WIDTH = 720;
  const NODE_MIN_WIDTH = 96;
  const NODE_MAX_WIDTH = 260;
  const NODE_PADDING_X = 18;
  const NODE_HEIGHT = 36;
  const X_GAP = 34;
  const Y_GAP = 76;
  const TREE_GAP = 92;

  let graph = { nodes: {}, edges: [], rootId: null };
  let settings = { width: DEFAULT_WIDTH, theme: "light", collapsed: false };
  let currentPage = getPageFromUrl(location.href);
  let panel;
  let canvasWrap;
  let footerStatus;
  let toggleButton;
  let widthDragging = false;
  let mapDragging = false;
  let mapDragStart = null;

  init();

  async function init() {
    if (!currentPage) return;

    await loadState();
    createPanel();
    document.addEventListener("click", onDocumentClick, true);

    ensureNode(currentPage);
    graph.rootId = graph.rootId || currentPage.id;
    await saveGraph();
    render();
  }

  async function loadState() {
    const stored = await chrome.storage.local.get([GRAPH_KEY, SETTINGS_KEY]);
    graph = stored[GRAPH_KEY] || { nodes: {}, edges: [], rootId: null };
    graph.nodes = graph.nodes || {};
    graph.edges = Array.isArray(graph.edges) ? graph.edges : [];
    settings = { ...settings, ...(stored[SETTINGS_KEY] || {}) };
    settings.width = clamp(Number(settings.width) || DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH);
    settings.theme = settings.theme === "dark" ? "dark" : "light";
    settings.collapsed = Boolean(settings.collapsed);
  }

  function createPanel() {
    panel = document.createElement("aside");
    panel.id = PANEL_ID;
    panel.setAttribute("aria-label", "Wiki Map");
    applyPanelState();

    const resizeHandle = document.createElement("div");
    resizeHandle.className = "wiki-map-resize";
    resizeHandle.title = "Drag to resize panel";
    resizeHandle.setAttribute("aria-label", "Resize Wiki Map panel");
    const resizeGrip = document.createElement("span");
    resizeGrip.className = "wiki-map-resize-grip";
    resizeHandle.append(resizeGrip);
    resizeHandle.addEventListener("pointerdown", startWidthResize);

    toggleButton = document.createElement("button");
    toggleButton.className = "wiki-map-toggle";
    toggleButton.type = "button";
    toggleButton.title = "Toggle Wiki Map";
    toggleButton.textContent = settings.collapsed ? "WM" : "X";
    toggleButton.addEventListener("click", togglePanel);

    const body = document.createElement("div");
    body.className = "wiki-map-body";

    const header = document.createElement("div");
    header.className = "wiki-map-header";

    const title = document.createElement("div");
    title.className = "wiki-map-title";
    title.textContent = "Wiki Map";

    const actions = document.createElement("div");
    actions.className = "wiki-map-actions";
    actions.append(
      createIconButton(getThemeButtonLabel(), "Toggle dark mode", toggleTheme, "theme"),
      createIconButton("Reset", "Delete all map history", resetGraph)
    );

    header.append(title, actions);

    canvasWrap = document.createElement("div");
    canvasWrap.className = "wiki-map-canvas-wrap";
    canvasWrap.addEventListener("pointerdown", startMapDrag);

    const footer = document.createElement("div");
    footer.className = "wiki-map-footer";
    footerStatus = document.createElement("span");
    const domain = document.createElement("span");
    domain.textContent = location.hostname;
    footer.append(footerStatus, domain);

    body.append(header, canvasWrap, footer);
    panel.append(resizeHandle, toggleButton, body);
    document.documentElement.append(panel);
  }

  function createIconButton(label, title, onClick, role) {
    const button = document.createElement("button");
    button.className = "wiki-map-icon-button";
    button.type = "button";
    button.title = title;
    button.textContent = label;
    if (role) button.dataset.role = role;
    button.addEventListener("click", onClick);
    return button;
  }

  async function togglePanel() {
    settings.collapsed = !settings.collapsed;
    applyPanelState();
    await saveSettings();
  }

  async function toggleTheme() {
    settings.theme = settings.theme === "dark" ? "light" : "dark";
    applyPanelState();
    const themeButton = panel.querySelector('[data-role="theme"]');
    if (themeButton) themeButton.textContent = getThemeButtonLabel();
    await saveSettings();
  }

  function getThemeButtonLabel() {
    return settings.theme === "dark" ? "Light" : "Dark";
  }

  function applyPanelState() {
    if (!panel) return;
    panel.classList.toggle("wiki-map-collapsed", settings.collapsed);
    panel.dataset.theme = settings.theme;
    panel.style.width = settings.collapsed ? "0px" : `${settings.width}px`;
    if (toggleButton) toggleButton.textContent = settings.collapsed ? "WM" : "X";
  }

  function startWidthResize(event) {
    if (settings.collapsed) return;
    widthDragging = true;
    event.preventDefault();
    panel.setPointerCapture(event.pointerId);
    panel.addEventListener("pointermove", resizePanel);
    panel.addEventListener("pointerup", stopWidthResize);
    panel.addEventListener("pointercancel", stopWidthResize);
  }

  function resizePanel(event) {
    if (!widthDragging) return;
    settings.width = clamp(window.innerWidth - event.clientX, MIN_WIDTH, Math.min(MAX_WIDTH, window.innerWidth - 48));
    applyPanelState();
    render();
  }

  async function stopWidthResize(event) {
    widthDragging = false;
    panel.releasePointerCapture(event.pointerId);
    panel.removeEventListener("pointermove", resizePanel);
    panel.removeEventListener("pointerup", stopWidthResize);
    panel.removeEventListener("pointercancel", stopWidthResize);
    await saveSettings();
  }

  function startMapDrag(event) {
    if (event.button !== 0) return;
    if (event.target.closest && event.target.closest(".wiki-map-node")) return;
    mapDragging = true;
    mapDragStart = {
      x: event.clientX,
      y: event.clientY,
      left: canvasWrap.scrollLeft,
      top: canvasWrap.scrollTop
    };
    canvasWrap.classList.add("is-dragging");
    canvasWrap.setPointerCapture(event.pointerId);
    canvasWrap.addEventListener("pointermove", dragMap);
    canvasWrap.addEventListener("pointerup", stopMapDrag);
    canvasWrap.addEventListener("pointercancel", stopMapDrag);
  }

  function dragMap(event) {
    if (!mapDragging || !mapDragStart) return;
    canvasWrap.scrollLeft = mapDragStart.left - (event.clientX - mapDragStart.x);
    canvasWrap.scrollTop = mapDragStart.top - (event.clientY - mapDragStart.y);
  }

  function stopMapDrag(event) {
    mapDragging = false;
    mapDragStart = null;
    canvasWrap.classList.remove("is-dragging");
    canvasWrap.releasePointerCapture(event.pointerId);
    canvasWrap.removeEventListener("pointermove", dragMap);
    canvasWrap.removeEventListener("pointerup", stopMapDrag);
    canvasWrap.removeEventListener("pointercancel", stopMapDrag);
  }

  async function onDocumentClick(event) {
    const anchor = event.target.closest && event.target.closest("a[href]");
    if (!anchor || !currentPage) return;
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (anchor.target && anchor.target !== "_self") return;
    if (anchor.hasAttribute("download")) return;

    const targetPage = getPageFromUrl(anchor.href);
    if (!targetPage || targetPage.id === currentPage.id) return;
    if (targetPage.host !== currentPage.host) return;

    event.preventDefault();
    ensureNode(currentPage);
    ensureNode(targetPage);
    addEdge(currentPage.id, targetPage.id, normalizeText(anchor.textContent) || targetPage.title);
    await saveGraph();
    render();
    location.assign(anchor.href);
  }

  function getPageFromUrl(urlValue) {
    let url;
    try {
      url = new URL(urlValue, location.href);
    } catch {
      return null;
    }

    if (!/\.wikipedia\.org$/.test(url.hostname)) return null;
    if (!url.pathname.startsWith("/wiki/")) return null;
    if (url.pathname.includes(":")) return null;

    const title = decodeURIComponent(url.pathname.replace(/^\/wiki\//, "")).replace(/_/g, " ");
    if (!title) return null;

    return {
      id: `${url.hostname}${url.pathname}`,
      host: url.hostname,
      url: `${url.origin}${url.pathname}`,
      title
    };
  }

  function normalizeText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function ensureNode(page) {
    if (!graph.nodes[page.id]) {
      graph.nodes[page.id] = {
        id: page.id,
        title: page.title,
        url: page.url,
        visits: 0,
        createdAt: Date.now()
      };
    }

    if (page.id === currentPage.id && graph.nodes[page.id].lastVisitToken !== location.href) {
      graph.nodes[page.id].visits += 1;
      graph.nodes[page.id].lastVisitedAt = Date.now();
      graph.nodes[page.id].lastVisitToken = location.href;
    }
  }

  function addEdge(fromId, toId, label) {
    const existing = graph.edges.find((edge) => edge.fromId === fromId && edge.toId === toId);
    if (existing) {
      existing.count += 1;
      existing.label = label || existing.label;
      existing.updatedAt = Date.now();
      return;
    }

    graph.edges.push({
      fromId,
      toId,
      label,
      count: 1,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  }

  function saveGraph() {
    return chrome.storage.local.set({ [GRAPH_KEY]: graph });
  }

  function saveSettings() {
    return chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  }

  async function resetGraph() {
    if (!window.confirm("Reset all Wiki Map history?")) return;
    graph = { nodes: {}, edges: [], rootId: currentPage ? currentPage.id : null };
    if (currentPage) ensureNode(currentPage);
    await saveGraph();
    render();
  }

  function render() {
    if (!canvasWrap) return;
    const previousLeft = canvasWrap.scrollLeft;
    const previousTop = canvasWrap.scrollTop;
    canvasWrap.textContent = "";

    const nodeCount = Object.keys(graph.nodes).length;
    if (nodeCount <= 1 && graph.edges.length === 0) {
      const empty = document.createElement("div");
      empty.className = "wiki-map-empty";
      empty.textContent = "Click a Wikipedia article link to start mapping page jumps.";
      canvasWrap.append(empty);
      updateFooter(nodeCount, graph.edges.length);
      return;
    }

    const layout = buildVerticalLayout();
    const svgWidth = Math.max(canvasWrap.clientWidth, layout.width);
    const svgHeight = Math.max(canvasWrap.clientHeight, layout.height);
    const nodeById = new Map(layout.nodes.map((node) => [node.id, node]));

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", String(svgWidth));
    svg.setAttribute("height", String(svgHeight));
    svg.setAttribute("viewBox", `0 0 ${svgWidth} ${svgHeight}`);

    const edgeLayer = document.createElementNS(SVG_NS, "g");
    const nodeLayer = document.createElementNS(SVG_NS, "g");
    svg.append(edgeLayer, nodeLayer);

    layout.edges.forEach((edge) => drawEdge(edgeLayer, edge, nodeById));
    layout.nodes.forEach((node) => drawNode(nodeLayer, node));

    canvasWrap.append(svg);
    canvasWrap.scrollLeft = previousLeft;
    canvasWrap.scrollTop = previousTop;
    if (!previousLeft && !previousTop) centerCurrentNode(layout.nodes);
    updateFooter(nodeCount, graph.edges.length);
  }

  function buildVerticalLayout() {
    const rootId = graph.rootId && graph.nodes[graph.rootId] ? graph.rootId : currentPage.id;
    const childEdges = new Map();
    const incomingCounts = new Map();
    graph.edges.forEach((edge) => {
      if (!childEdges.has(edge.fromId)) childEdges.set(edge.fromId, []);
      childEdges.get(edge.fromId).push(edge);
      incomingCounts.set(edge.toId, (incomingCounts.get(edge.toId) || 0) + 1);
    });

    const placed = new Set();
    const nodes = [];
    let yOffset = 0;
    let widestLevel = 1;

    getOrderedRoots(rootId, incomingCounts).forEach((componentRootId) => {
      if (placed.has(componentRootId) || !graph.nodes[componentRootId]) return;
      const levels = collectLevels(componentRootId, childEdges, placed);
      if (levels.length === 0) return;

      levels.forEach((ids, depth) => {
        const nodeItems = ids.map((id) => ({
          id,
          width: getNodeWidth(graph.nodes[id].title)
        }));
        const levelWidth = nodeItems.reduce((sum, item) => sum + item.width, 0) + Math.max(0, nodeItems.length - 1) * X_GAP;
        widestLevel = Math.max(widestLevel, levelWidth);

        const xOffset = Math.max(24, (settings.width - levelWidth) / 2);
        let nextX = xOffset;
        ids.forEach((id, index) => {
          const width = nodeItems[index].width;
          nodes.push({
            ...graph.nodes[id],
            width,
            depth,
            x: nextX,
            y: 24 + yOffset + depth * (NODE_HEIGHT + Y_GAP)
          });
          nextX += width + X_GAP;
        });
      });

      yOffset += levels.length * (NODE_HEIGHT + Y_GAP) + TREE_GAP;
    });

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const edges = graph.edges.filter((edge) => nodeById.has(edge.fromId) && nodeById.has(edge.toId));

    return {
      nodes,
      edges,
      width: Math.max(settings.width, widestLevel + 48),
      height: Math.max(220, yOffset + 28)
    };
  }

  function getOrderedRoots(rootId, incomingCounts) {
    const ids = Object.keys(graph.nodes);
    const roots = [rootId];
    ids
      .filter((id) => id !== rootId && !incomingCounts.has(id))
      .sort(compareNodesByTime)
      .forEach((id) => roots.push(id));
    ids
      .filter((id) => !roots.includes(id))
      .sort(compareNodesByTime)
      .forEach((id) => roots.push(id));
    return roots;
  }

  function collectLevels(startId, childEdges, placed) {
    const levels = [];
    const queue = [{ id: startId, depth: 0 }];

    while (queue.length > 0) {
      const item = queue.shift();
      if (placed.has(item.id) || !graph.nodes[item.id]) continue;

      placed.add(item.id);
      if (!levels[item.depth]) levels[item.depth] = [];
      levels[item.depth].push(item.id);

      const children = (childEdges.get(item.id) || []).slice().sort(compareEdges);
      children.forEach((edge) => queue.push({ id: edge.toId, depth: item.depth + 1 }));
    }

    return levels;
  }

  function compareNodesByTime(aId, bId) {
    const a = graph.nodes[aId];
    const b = graph.nodes[bId];
    return (a.createdAt || 0) - (b.createdAt || 0);
  }

  function compareEdges(a, b) {
    return (a.updatedAt || a.createdAt || 0) - (b.updatedAt || b.createdAt || 0);
  }

  function drawEdge(layer, edge, nodeById) {
    const from = nodeById.get(edge.fromId);
    const to = nodeById.get(edge.toId);
    if (!from || !to) return;

    const x1 = from.x + from.width / 2;
    const y1 = from.y + NODE_HEIGHT;
    const x2 = to.x + to.width / 2;
    const y2 = to.y;
    const midY = y1 + Math.max(24, (y2 - y1) / 2);

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("class", "wiki-map-edge");
    path.setAttribute("d", `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`);
    layer.append(path);

    if (edge.count > 1) {
      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("class", "wiki-map-edge-label");
      label.setAttribute("x", String((x1 + x2) / 2 + 4));
      label.setAttribute("y", String(midY - 4));
      label.textContent = `x${edge.count}`;
      layer.append(label);
    }
  }

  function drawNode(layer, node) {
    const group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("class", `wiki-map-node${node.id === currentPage.id ? " is-current" : ""}`);
    group.setAttribute("transform", `translate(${node.x}, ${node.y})`);
    group.style.cursor = "pointer";
    group.addEventListener("click", () => {
      if (node.url !== location.href) location.href = node.url;
    });

    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("width", String(node.width));
    rect.setAttribute("height", String(NODE_HEIGHT));
    rect.setAttribute("rx", "6");

    const text = document.createElementNS(SVG_NS, "text");
    text.setAttribute("x", String(node.width / 2));
    text.setAttribute("y", "22");
    text.setAttribute("text-anchor", "middle");
    text.textContent = truncateToWidth(node.title, node.width - NODE_PADDING_X * 2);

    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = node.title;

    group.append(title, rect, text);
    layer.append(group);
  }

  function centerCurrentNode(nodes) {
    const current = nodes.find((node) => node.id === currentPage.id);
    if (!current) return;
    canvasWrap.scrollTo({
      left: Math.max(0, current.x - canvasWrap.clientWidth / 2 + current.width / 2),
      top: Math.max(0, current.y - 72),
      behavior: "smooth"
    });
  }

  function updateFooter(nodeCount, edgeCount) {
    if (footerStatus) footerStatus.textContent = `${nodeCount} pages / ${edgeCount} jumps`;
  }

  function getNodeWidth(title) {
    return clamp(Math.ceil(estimateTextWidth(title) + NODE_PADDING_X * 2), NODE_MIN_WIDTH, NODE_MAX_WIDTH);
  }

  function truncateToWidth(value, maxWidth) {
    if (estimateTextWidth(value) <= maxWidth) return value;
    let result = value;
    while (result.length > 1 && estimateTextWidth(`${result}...`) > maxWidth) {
      result = result.slice(0, -1);
    }
    return `${result}...`;
  }

  function estimateTextWidth(value) {
    return Array.from(value).reduce((sum, char) => {
      return sum + (/[ -~]/.test(char) ? 7 : 14);
    }, 0);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
})();
