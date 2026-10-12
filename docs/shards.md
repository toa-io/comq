# Changing the number of brokers

How brokers are added to and removed from under a connection that follows
[names](../readme.md#virtual-shards), with everyone connected staying as they are.

## Names

- **As many names as there may ever be brokers.** A broker is in the pool while at least one name
  stands for it, so the number of names is the most brokers there can be. Names cost nothing:
  thirty-two of them over two brokers are two connections.
- **How many names a broker has does not matter.** A publication goes to a broker chosen at random
  among those in the pool, not to a name: a broker with one name out of thirty-two takes as much as
  one with the rest.
- **One address per name.** A name with several addresses is still one broker, connected through
  one of them. Records that rotate between brokers spread nothing.
- **A short TTL.** Unless [given](../readme.md#timing), the `settle` and `linger` times are the
  longest TTL of the names and no less than 30 seconds, so the TTL is what a change takes.
- **The same names for everyone.** One who connects by addresses, or by names of their own, follows
  nothing, and is cut off once a broker is removed.

## Adding a broker

1. **Start the broker and give it what the others have**: the virtual hosts, the users and their
   permissions.
2. **Copy the exchanges, the queues and the bindings between them** from a broker in the pool.
   Everyone follows the names on their own, so the one who emits an Event may join the new broker
   before the one who consumes it has: an exchange with no queue bound to it yet drops what is
   published to it. A Request needs none of this, its queue being declared by the one who sends it.

   Queues exclusive to a connection, and their bindings, are not to be copied: they are declared
   by the connection that owns them when it joins.
3. **Point names at it.** Which ones and how many is of no consequence, so move as few as it
   takes for the names to be spread evenly: these are the ones to move back once it is removed.
4. **See the connections arrive.** A `settle` time after the records have changed, everyone who
   follows the names is connected to the new broker as well as to the others.

Nothing is taken away while a broker is being added: a name pointing at a broker that is not there
yet, or not reachable, retires no one.

## Removing a broker

1. **Point its names at the others.** A `settle` time later nothing new is published to it. It is
   still consumed from, and what was sent through it is still answered through it.
2. **Wait until it has no connections.** Each one leaves by itself once, for the `linger` time,
   it has had nothing to do there. There is no deadline: a connection with a message still in
   work, or a Request still unanswered, stays.
3. **Look at what is left** before the broker is stopped:
   - *a connection that stays* is of one who does not follow the names, or of one whose work
     there does not end;
   - *a message in a queue nobody consumes* had no consumer before the broker was retired
     either, and goes with the broker.
4. **Stop the broker.**

Until it is stopped, the removal is undone by pointing a name back at the broker: it is in the
pool again once the answer has settled.

## Replacing a broker

Both of the above in one change of the records: the names of the old broker are pointed at the new
one. The new broker is joined before the old one is retired, so the order need not be kept by hand.
The new broker is prepared as [one being added](#adding-a-broker) is, and the old one is stopped as
[one being removed](#removing-a-broker) is.

## What to expect

- A change of the records may be made in any order and need not be made at once: nothing is acted
  upon until the answers have stayed the same for the `settle` time.
- A broker that is in the pool and goes out of reach is a [lost shard](../readme.md#sharded-connection),
  whatever the names say: what was sent through it and is not answered is sent again through the
  others. Retiring a broker first is what makes its removal lose nothing.
- No one is restarted or reconfigured. One who starts while the names are moving connects to what
  they resolve to then, and follows them from there.
