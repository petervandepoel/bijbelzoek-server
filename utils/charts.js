import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import "chart.js/auto";

export async function renderFromConfig(cfg = {}, opts = {}) {
  const width = Number(opts.width || cfg.width || 1200);
  const height = Number(opts.height || cfg.height || 700);
  const canvas = new ChartJSNodeCanvas({ width, height, backgroundColour: "white" });
  const config = { ...cfg };
  if (!config.options) config.options = {};
  config.options.responsive = false;
  config.options.devicePixelRatio = 1;
  return await canvas.renderToBuffer(config, "image/png");
}