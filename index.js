import express from 'express'
import cors from 'cors'
import { MongoClient, ObjectId } from 'mongodb'
import { betterAuth } from 'better-auth'
import { mongodbAdapter } from 'better-auth/adapters/mongodb'
import { toNodeHandler } from 'better-auth/node'
import 'dotenv/config'

const app = express()
const port = 8000

// middleware
app.use(
  cors({
    origin: ['http://localhost:3000'],
    credentials: true,
  })
)

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
const borrows = db.collection(`borrows`);

// auth (better-auth with the MongoDB instance)
const auth = betterAuth({
  database: mongodbAdapter(db),
  emailAndPassword: {
    enabled: true,
  },
  trustedOrigins: ['http://localhost:3000'],
})

app.all('/api/auth/*splat', toNodeHandler(auth))


// Serialize Mongo documents so `_id` is a plain string for the frontend
const serialize = (doc) => ({ ...doc, _id: String(doc._id) });

// Parse a document id from the URL, returns null when invalid
const parseId = (id) => {
  try {
    return new ObjectId(id);
  } catch {
    return null;
  }
};


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

    res.status(200).send(allBooks.map(serialize));
  } catch (error) {
    res.status(500).send({
      message: "Failed to fetch books",
    });
  }
});

app.get('/books/:id', async (req, res) => {
  try {
    const bookId = parseId(req.params.id);

    if (!bookId) {
      return res.status(404).send({ message: 'Book not found' });
    }

    const book = await books.findOne({ _id: bookId });

    if (!book) {
      return res.status(404).send({ message: 'Book not found' });
    }

    res.status(200).send(serialize(book));
  } catch (error) {
    res.status(500).send({ message: 'Failed to fetch the book' });
  }
})

app.post('/books', async (req, res) => {
  try {
    const result = await books.insertOne(req.body);
    const created = await books.findOne({ _id: result.insertedId });

    res.status(201).send(serialize(created));
  } catch (error) {
    res.status(500).send({ message: 'Failed to add the book' });
  }
})

app.put('/books/:id', async (req, res) => {
  try {
    const bookId = parseId(req.params.id);

    if (!bookId) {
      return res.status(404).send({ message: 'Book not found' });
    }

    const updated = await books.findOneAndUpdate(
      { _id: bookId },
      { $set: req.body },
      { returnDocument: 'after' }
    );

    if (!updated) {
      return res.status(404).send({ message: 'Book not found' });
    }

    res.status(200).send(serialize(updated));
  } catch (error) {
    res.status(500).send({ message: 'Failed to update the book' });
  }
})

app.delete('/books/:id', async (req, res) => {
  try {
    const bookId = parseId(req.params.id);

    if (!bookId) {
      return res.status(404).send({ message: 'Book not found' });
    }

    const result = await books.deleteOne({ _id: bookId });

    if (result.deletedCount === 0) {
      return res.status(404).send({ message: 'Book not found' });
    }

    res.status(200).send({ message: 'Book deleted successfully' });
  } catch (error) {
    res.status(500).send({ message: 'Failed to delete the book' });
  }
})


// borrows

app.post('/borrow', async (req, res) => {
  try {
    const record = {
      ...req.body,
      borrowDate: new Date().toISOString(),
    };

    const result = await borrows.insertOne(record);
    const created = await borrows.findOne({ _id: result.insertedId });

    res.status(201).send(serialize(created));
  } catch (error) {
    res.status(500).send({ message: 'Failed to borrow this book' });
  }
})

app.get('/borrows', async (req, res) => {
  try {
    const query = {};

    // Optional filter, e.g. /borrows?email=...
    if (req.query.email) {
      query.email = req.query.email;
    }

    const allBorrows = await borrows.find(query).toArray();

    res.status(200).send(allBorrows.map(serialize));
  } catch (error) {
    res.status(500).send({
      message: 'Failed to fetch borrowed books',
    });
  }
})

app.delete('/borrow/:id', async (req, res) => {
  try {
    const borrowId = parseId(req.params.id);

    if (!borrowId) {
      return res.status(404).send({ message: 'Borrow record not found' });
    }

    const result = await borrows.deleteOne({ _id: borrowId });

    if (result.deletedCount === 0) {
      return res.status(404).send({ message: 'Borrow record not found' });
    }

    res.status(200).send({ message: 'Borrow record removed successfully' });
  } catch (error) {
    res.status(500).send({ message: 'Failed to remove the borrowed book' });
  }
})

app.listen(port, () => {
  console.log(`server is running at ${port}`)
})
