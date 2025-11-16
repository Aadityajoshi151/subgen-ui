# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
WORKDIR /app

# Install deps separately for caching
COPY package*.json ./
RUN npm install --only=production

# Copy source
COPY . .

# Ensure content directory exists (will be bind-mounted)
RUN mkdir -p content

EXPOSE 8585
CMD ["npm","start"]
