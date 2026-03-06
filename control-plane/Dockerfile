FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY scripts ./scripts
COPY sql ./sql
COPY data ./data

EXPOSE 8787
CMD ["npm", "start"]
