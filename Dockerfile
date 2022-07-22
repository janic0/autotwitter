FROM node
ADD . /app
WORKDIR /app
RUN npm install
RUN npm run build

ENTRYPOINT ["npm", "start"]
