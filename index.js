import express from 'express' 
import cors from 'cors' 
import { MongoClient } from 'mongodb'; 
import 'dotenv/config'

const app = express()
const port = 8000

// middleware 
app.use(cors()) 
app.use(express.json()) 


// mongodb

const client = new MongoClient(process.env.MONGODB_URI);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

 const connectedclient = await connectToMongoDB() 
const db = connectedclient.db(`book_nook_backend`) ;
const books = db.collection(`books`);


// http://localhost:8000

app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.get('/books', async (req, res) => {
  try {
    const limit = Number(req.query.limit);

    const cursor = books.find({});

    if (limit > 0) {
      cursor.limit(limit);
    }

    const allBooks = await cursor.toArray();

    res.status(200).send(allBooks);
  } catch (error) {
    res.status(500).send({
      message: "Failed to fetch books",
    });
  }
});

app.listen(port, () => {
  console.log(`server is running at ${port}`)
})


