FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 10000

CMD ["sh", "-c", "node scripts/migrate.js && node src/app.js"]
