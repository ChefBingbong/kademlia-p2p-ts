FROM node:20-alpine

RUN apk add python3 g++ make
ENV NODE_ENV production

WORKDIR /usr/src/app
COPY . /usr/src/app

RUN yarn install --only=production

CMD ["yarn", "start", "src/index.ts"]