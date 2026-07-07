/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: [
    "192.168.68.102",
    "192.168.68.108",
    "192.168.68.105",
    "192.168.68.103",
    "192.168.68.104",
    "192.168.68.106",
  ],
  outputFileTracingIncludes: {
    "/api/admin/create-business": ["./public/locations/neighborhoods/**/*.json"],
    "/api/admin/update-business": ["./public/locations/neighborhoods/**/*.json"],
  },
};

module.exports = nextConfig;
