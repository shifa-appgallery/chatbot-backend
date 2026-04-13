import { DataTypes, Model, Optional } from "sequelize";
import { getSequelize } from "../../config/mysql";

interface TeamUsersAttributes {
  id: number;
  team_id: number;
  user_id: number;
  parent_id?: number;
  team_other_informations?: string;
  status?: number;
  isDelete?: boolean;
  notifications_id?: number;
  role_id?: number;
}

interface TeamUsersCreationAttributes
  extends Optional<TeamUsersAttributes, "id"> {}

export class TeamUsers
  extends Model<TeamUsersAttributes, TeamUsersCreationAttributes>
  implements TeamUsersAttributes
{
  public id!: number;
  public team_id!: number;
  public user_id!: number;
  public parent_id!: number;
  public team_other_informations!: string;
  public status!: number;
  public isDelete!: boolean;
  public notifications_id!: number;
  public role_id!: number;
}

export const initTeamUsersModel = () => {
  const sequelize = getSequelize();

  if (!sequelize) {
    throw new Error("❌ Sequelize not initialized");
  }

  TeamUsers.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      team_id: {
        type: DataTypes.INTEGER,
      },
      user_id: {
        type: DataTypes.INTEGER,
      },
      parent_id: {
        type: DataTypes.INTEGER,
      },
      team_other_informations: {
        type: DataTypes.TEXT,
      },
      status: {
        type: DataTypes.INTEGER,
      },
      isDelete: {
        type: DataTypes.BOOLEAN,
      },
      notifications_id: {
        type: DataTypes.INTEGER,
      },
      role_id: {
        type: DataTypes.INTEGER,
      },
    },
    {
      sequelize,
      tableName: "team_users",
      timestamps: false,
    }
  );
};