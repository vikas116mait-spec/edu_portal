const rawApiOrigin = process.env.CS_PORTAL_API_ORIGIN?.trim();
const apiOrigin = rawApiOrigin?.replace(/\/+$/, "");

if (apiOrigin) {
  const parsedApiOrigin = new URL(apiOrigin);
  if (parsedApiOrigin.protocol !== "https:" || parsedApiOrigin.pathname !== "/") {
    throw new Error(
      "CS_PORTAL_API_ORIGIN must be an HTTPS origin without a path."
    );
  }
}

export const config = {
  framework: null,
  outputDirectory: "public",
  rewrites: apiOrigin
    ? [
        {
          source: "/api/:path*",
          destination: `${apiOrigin}/api/:path*`,
        },
      ]
    : [],
};
