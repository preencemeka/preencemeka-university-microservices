FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY vite.config.js ./
RUN npm install
COPY index.html ./
COPY public ./public
COPY src ./src
RUN npm run build
EXPOSE 5173
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "5173"]
