// In the page: lay out with ARGMAP, export a PNG with Excalidraw. Kept as plain JS so no bundler helper reaches it.
window.ARGMAP_EXPORT = async ({ data, opt, dark, scale }) => {
  const all = JSON.stringify(data); // 按实际用到的字加载字体分片，否则测量用的是回退字体
  for (const f of ["Excalifont", "Xiaolai", "Nunito"])
    for (const sz of [15, 16, 19, 23, 30]) await document.fonts.load(`${sz}px ${f}`, all);
  // 第一遍只为让 Excalidraw 注册并加载场景里的字体；第二遍才用真实字形测量排版
  await EXC.exportToSvg({ elements: ARGMAP(data, opt).elements, files: null, appState: {} });
  await document.fonts.ready;
  const { elements, size } = ARGMAP(data, opt);
  await document.fonts.ready;
  const bg = "#fffdf8";
  const blob = await EXC.exportToBlob({
    elements,
    files: null,
    exportPadding: 56,
    mimeType: "image/png",
    getDimensions: (w, h) => ({ width: w * scale, height: h * scale, scale }),
    appState: {
      exportBackground: true,
      viewBackgroundColor: bg,
      exportScale: scale,
      exportWithDarkMode: dark,
    },
  });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode(...buf.subarray(i, i + 8192));
  return {
    png: btoa(s),
    scene: {
      type: "excalidraw",
      version: 2,
      source: "argmap",
      elements,
      appState: { viewBackgroundColor: bg },
      files: {},
    },
    size,
  };
};
