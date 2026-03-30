import { Sequelize } from "sequelize";
import { Client } from "ssh2";
import net from "net";
import dotenv from "dotenv";
dotenv.config();

let sequelize: Sequelize;
console.log(process.env.MYSQL_DB)
console.log(process.env.MYSQL_USER)
console.log(process.env.MYSQL_PASSWORD)
            
            

export const connectWithSSH = async () => {
  return new Promise<Sequelize>((resolve, reject) => {
    const ssh = new Client();

    ssh.on("ready", () => {
      console.log("✅ SSH connected");

      // Create local server (acts like tunnel)
      const server = net.createServer((localSocket) => {
        ssh.forwardOut(
          localSocket.remoteAddress || "127.0.0.1",
          localSocket.remotePort || 0,
          "127.0.0.1",
          3306,
          (err, stream) => {
            if (err) {
              localSocket.destroy();
              return;
            }
            localSocket.pipe(stream);
            stream.pipe(localSocket);
          }
        );
      });

      server.listen(3307, "127.0.0.1", async () => {
        console.log("🚀 Tunnel running on port 3307");

        try {
          sequelize = new Sequelize(
            process.env.MYSQL_DB!,
            process.env.MYSQL_USER!,
            process.env.MYSQL_PASSWORD!,
            {
              host: "127.0.0.1",
              port: 3307, // 👈 IMPORTANT
              dialect: "mysql",
              logging: false,
            }
          );

          await sequelize.authenticate();
          console.log("✅ MySQL connected via SSH");

          resolve(sequelize);
        } catch (error) {
          reject(error);
        }
      });
    });

    ssh.connect({
      host: process.env.SSH_HOST!,
      port: Number(process.env.SSH_PORT) || 22,
      username: process.env.SSH_USER!,
      privateKey: require("fs").readFileSync(process.env.SSH_KEY_PATH!),
    });

    ssh.on("error", (err) => reject(err));
  });
};

export const getSequelize = () => {
  if (!sequelize) {
    throw new Error("❌ Sequelize not initialized");
  }
  return sequelize;
};