/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // pdfjs-dist는 브라우저에서만 쓰므로 node canvas는 제외
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
