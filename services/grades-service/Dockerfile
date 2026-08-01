FROM node:24-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY src ./src
EXPOSE 4004
CMD ["npm", "run", "start"]
