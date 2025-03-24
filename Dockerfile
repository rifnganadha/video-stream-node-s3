FROM node:23.8-slim

RUN apt-get update \
    && apt-get -y install ffmpeg \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . /app

RUN npm install

RUN cp .env.example .env

EXPOSE 3000
CMD ["npm", "start"]