FROM node:18-alpine
WORKDIR /app
RUN npm install -g npm@9
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 80
CMD ["npm", "start"]
