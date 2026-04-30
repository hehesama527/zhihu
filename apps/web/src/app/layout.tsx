import type { ReactNode } from "react";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "矩阵工作台",
  description: "在知乎工作台与 Twitter / X 工作台之间切换。"
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  // 浏览器只能看到代理路径，不能看到内部地址
  const apiBaseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";
  const controlApiBaseUrl =
    process.env.NEXT_PUBLIC_CONTROL_API_BASE_URL ?? "/control-api";
  const hotspotApiBaseUrl =
    process.env.NEXT_PUBLIC_HOTSPOT_API_BASE_URL ?? "/hotspot-api";
  const imageApiBaseUrl = controlApiBaseUrl;
  const xApiBaseUrl =
    process.env.NEXT_PUBLIC_X_API_BASE_URL ?? "/x-api";

  return (
    <html lang="zh-CN">
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__ZHIHU_MVP_API_BASE_URL__ = ${JSON.stringify(apiBaseUrl)}; window.__ZHIHU_MVP_IMAGE_API_BASE_URL__ = ${JSON.stringify(imageApiBaseUrl)}; window.__ZHIHU_MVP_CONTROL_API_BASE_URL__ = ${JSON.stringify(controlApiBaseUrl)}; window.__ZHIHU_MVP_HOTSPOT_API_BASE_URL__ = ${JSON.stringify(hotspotApiBaseUrl)}; window.__X_MVP_API_BASE_URL__ = ${JSON.stringify(xApiBaseUrl)};`
          }}
        />
        <script src="https://mcp.figma.com/mcp/html-to-design/capture.js" async></script>
        {children}
      </body>
    </html>
  );
}
