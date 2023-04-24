FROM node
ADD . /app
WORKDIR /app
RUN yarn
RUN yarn build

ENTRYPOINT ["npm", "start"]
