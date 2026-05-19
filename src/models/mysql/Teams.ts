// src/models/mysql/Team.ts

import { DataTypes, Model, Optional } from "sequelize";
import { getSequelize } from "../../config/mysql";

interface TeamAttributes {
  id: number;
  team_name: string;
  manager_id: number;
}

interface TeamCreationAttributes
  extends Optional<TeamAttributes, "id"> { }

export class Teams
  extends Model<TeamAttributes, TeamCreationAttributes>
  implements TeamAttributes {

  public id!: number;
  public team_name!: string;
  public manager_id!: number;
}

export const initTeamModel = () => {

  const sequelize = getSequelize();

  if (!sequelize) {
    throw new Error("Sequelize not initialized");
  }

  Teams.init(
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true
      },

      team_name: {
        type: DataTypes.STRING,
        allowNull: false
      },

      manager_id: {
        type: DataTypes.INTEGER,
        allowNull: false
      }
    },
    {
      sequelize,
      tableName: "teams",
      timestamps: false
    }
  );
};